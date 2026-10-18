import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-coursera-test-"));
process.env.STUDYBUDDY_FS_ROOT = root;
process.env.STUDYBUDDY_LIBRARY_DIR = path.join(root, "Courses");
process.env.STUDYBUDDY_COURSERA_DIR = path.join(root, "engine");
fs.mkdirSync(process.env.STUDYBUDDY_COURSERA_DIR);
fs.writeFileSync(path.join(process.env.STUDYBUDDY_COURSERA_DIR, "extractors.py"), "");
const python = path.join(root, "fake-python");
fs.writeFileSync(python, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [, , script, source, slug, destination] = process.argv;
if (process.env.STUDYBUDDY_COURSERA_AUTH === 'firefox') {
  if (process.env.STUDYBUDDY_CAUTH !== '') process.exit(2);
} else if (process.env.STUDYBUDDY_CAUTH !== 'private-session-value') process.exit(2);
if (process.argv.some(x => x.includes('private-session-value'))) process.exit(3);
setTimeout(() => {
  if (slug === 'access-denied') { console.error('Download fallito: access'); process.exit(1); }
  if (slug === 'failed-course') { console.error('private-session-value'); process.exit(1); }
  const dir = path.join(destination, slug, '01_module');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lesson.srt'), 'course material');
  if (slug === 'partial-course') console.log('Download parziale: syllabus');
}, 80);
`, { mode: 0o700 });
process.env.STUDYBUDDY_COURSERA_PYTHON = python;
const { parseCourseraUrl, startDownload, currentDownload } = await import("@/lib/courseraDownload");
after(() => fs.rmSync(root, { recursive: true, force: true }));

async function settled() {
  const deadline = Date.now() + 5000;
  while (currentDownload()?.status === "running" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(currentDownload()?.status, "running");
  // La pulizia della cartella temporanea avviene nel finally.
  await new Promise((r) => setTimeout(r, 30));
  return currentDownload()!;
}

test("link Coursera: home e query ammessi, host estranei e slug pericolosi rifiutati", () => {
  assert.equal(parseCourseraUrl("https://www.coursera.org/learn/sample-course/home/week/1?x=1"), "sample-course");
  assert.equal(parseCourseraUrl("https://coursera.org/learn/sample-course"), "sample-course");
  for (const url of [null, {}, "sample-course", "http://coursera.org/learn/a", "https://coursera.org.evil.test/learn/a",
    "https://evil.test/learn/a", "https://user:pass@coursera.org/learn/a", "https://coursera.org:444/learn/a",
    "https://coursera.org/learn/%2e%2e", "https://coursera.org/learn/--help", "https://coursera.org/specializations/a"])
    assert.throws(() => parseCourseraUrl(url));
});

test("download: cookie solo nell'ambiente, esclusione concorrente, pubblicazione e pulizia; errori senza segreti", async () => {
  assert.throws(() => startDownload({ url: "https://coursera.org/learn/test-course", cauth: "" }), /CAUTH/);
  const input = { url: "https://coursera.org/learn/test-course", cauth: "private-session-value" };
  const job = startDownload(input);
  assert.equal(job.status, "running");
  assert.equal(JSON.stringify(job).includes(input.cauth), false);
  assert.throws(() => startDownload(input), /già un download/);
  assert.equal(fs.existsSync(path.join(process.env.STUDYBUDDY_LIBRARY_DIR!, "test-course")), false);
  const done = await settled();
  assert.equal(done.status, "done");
  assert.equal(fs.readFileSync(path.join(done.path!, "01_module/lesson.srt"), "utf8"), "course material");
  assert.throws(() => startDownload(input), /già nella libreria/);
  startDownload({ ...input, url: "https://coursera.org/learn/failed-course" });
  const failed = await settled();
  assert.equal(failed.status, "error");
  assert.equal(failed.path, undefined);
  assert.equal(JSON.stringify(failed).includes(input.cauth), false);
  assert.deepEqual(fs.readdirSync(process.env.STUDYBUDDY_LIBRARY_DIR!), ["test-course"]);
  startDownload({ ...input, url: "https://coursera.org/learn/access-denied" });
  assert.match((await settled()).error!, /401\/403/);
  startDownload({ ...input, url: "https://coursera.org/learn/partial-course" });
  const partial = await settled();
  assert.equal(partial.status, "done");
  assert.match(partial.warning!, /Download parziale/);
  assert.ok(fs.existsSync(path.join(partial.path!, "01_module/lesson.srt")));
  assert.throws(() => startDownload({ ...input, auth: "other" }), /Metodo di accesso/);
  startDownload({ url: "https://coursera.org/learn/firefox-course", auth: "firefox" });
  assert.equal((await settled()).status, "done");
});

test("adattatore Python: estrazione headless, opzioni, risorse fallite e nessun traceback con segreti", async () => {
  const { run } = await import("@/lib/proc");
  const engine = path.join(root, "bridge-engine");
  fs.mkdirSync(engine);
  fs.writeFileSync(path.join(engine, "requests.py"), `
class Cookies:
    def set(self, name, value, domain):
        assert name == 'CAUTH' and value == 'secret-cookie' and domain == '.coursera.org'
class Session:
    def __init__(self): self.cookies = Cookies()
class exceptions:
    class RequestException(OSError): pass
    class HTTPError(RequestException):
        def __init__(self):
            self.response = type('Response', (), {'status_code': 403})()
`);
  fs.writeFileSync(path.join(engine, "extractors.py"), `
import os
class CourseraExtractor:
    def __init__(self, session): pass
    def get_modules(self, slug, reverse, unrestricted, language, resolution, quizzes, mathjax, notebooks):
        import requests
        if slug == 'access-denied': raise requests.exceptions.HTTPError()
        if slug == 'offline': raise requests.exceptions.RequestException('secret-cookie')
        assert 'STUDYBUDDY_CAUTH' not in os.environ
        assert language == 'all' and resolution == '720p'
        assert not quizzes and not notebooks
        return slug in ('bad-syllabus', 'partial-syllabus'), [] if slug == 'bad-syllabus' else [slug]
`);
  fs.writeFileSync(path.join(engine, "downloaders.py"), `
def get_downloader(session, slug, args):
    assert args.file_formats == ['all'] and args.resume and not args.overwrite
    return None
`);
  fs.writeFileSync(path.join(engine, "parallel.py"), `
class ConsecutiveDownloader:
    def __init__(self, downloader): pass
`);
  fs.writeFileSync(path.join(engine, "workflow.py"), `
import os
class CourseraDownloader:
    def __init__(self, downloader, args, slug, path, ignored_formats, disable_url_skipping):
        self.path, self.slug = path, slug
        self.failed_urls = []
    def download_modules(self, modules):
        if self.slug == 'bad-resource': self.failed_urls = ['secret-cookie']
        if self.slug == 'exception': raise RuntimeError('secret-cookie')
        if self.slug == 'false-result': self._download_completion_handler('secret-cookie', False)
        os.makedirs(os.path.join(self.path, self.slug), exist_ok=True)
        with open(os.path.join(self.path, self.slug, 'lesson.srt'), 'w') as f: f.write('synthetic subtitle')
`);
  const script = path.resolve("scripts/coursera_download.py");
  const env = { ...process.env, STUDYBUDDY_CAUTH: "secret-cookie", PYTHONDONTWRITEBYTECODE: "1" };
  const ok = await run("python3", [script, engine, "good-course", root], { timeoutMs: 5000, env });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(fs.readFileSync(path.join(root, "good-course/lesson.srt"), "utf8"), "synthetic subtitle");
  const partial = await run("python3", [script, engine, "partial-syllabus", root], { timeoutMs: 5000, env });
  assert.equal(partial.code, 0, partial.stderr);
  assert.equal(partial.stdout.trim(), "Download parziale: syllabus");
  assert.ok(fs.existsSync(path.join(root, "partial-syllabus/lesson.srt")));
  for (const [slug, code] of [["bad-syllabus", "syllabus"], ["bad-resource", "resources"],
    ["exception", "unknown"], ["false-result", "resources"], ["access-denied", "access"], ["offline", "network"]]) {
    const result = await run("python3", [script, engine, slug, root], { timeoutMs: 5000, env });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Download fallito/);
    assert.equal(result.stderr.trim(), `Download fallito: ${code}`);
    assert.doesNotMatch(result.stderr + result.stdout, /secret-cookie|Traceback/);
  }
  const noSession = await run("python3", [script, engine, "good-course", root], {
    timeoutMs: 5000,
    env: { ...env, STUDYBUDDY_COURSERA_AUTH: "firefox", STUDYBUDDY_FIREFOX_DIR: path.join(root, "missing-profile") },
  });
  assert.equal(noSession.code, 1);
  assert.equal(noSession.stderr.trim(), "Download fallito: firefox-session");
});


test("Firefox: legge CAUTH recente e valido dal WAL, ignora altri domini, originali intatti", async () => {
  const { run } = await import("@/lib/proc");
  const fixture = path.join(root, "firefox-profiles");
  const result = await run("python3", ["-c", `
import hashlib, os, sqlite3, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from firefox_cookie import firefox_cauth
root = Path(sys.argv[2])
profile = root / 'profile.default-release'
profile.mkdir(parents=True)
original = profile / 'cookies.sqlite'
connection = sqlite3.connect(original)
connection.execute('PRAGMA journal_mode=WAL')
connection.execute('CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, expiry INTEGER, lastAccessed INTEGER)')
connection.commit()
connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
connection.executemany('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?)', [
    ('CAUTH', 'correct-session', '.coursera.org', int(time.time()) + 3600, 100),
    ('CAUTH', 'expired', '.coursera.org', 1, 1000),
    ('CAUTH', 'wrong-domain', '.coursera.org.evil.test', int(time.time()) + 3600, 2000),
    ('OTHER', 'unrelated', '.coursera.org', int(time.time()) + 3600, 3000),
])
connection.commit()
def snapshot():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in profile.iterdir()}
before = snapshot()
os.environ['STUDYBUDDY_FIREFOX_DIR'] = str(root)
assert firefox_cauth() == 'correct-session'
assert snapshot() == before
connection.close()
os.environ['STUDYBUDDY_FIREFOX_DIR'] = str(root / 'missing')
try:
    firefox_cauth()
except RuntimeError:
    pass
else:
    raise AssertionError('Profilo assente deve fallire')
print('Firefox WAL e originali verificati')
`, path.resolve("scripts"), fixture], { timeoutMs: 5000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /originali verificati/);
});
