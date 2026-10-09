import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LibraryError } from "@/lib/errors";
import { listVods, resolveMedia, saveUpload, sf6Paths } from "@/lib/sf6/files";
import { decodeYtDlpFailure, isYoutubeUrl, parseVtt } from "@/lib/sf6/youtube";
import { assertHttpUrl, exclusive } from "@/lib/sf6/sources";

const asEnv = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const err = (status: number) => (e: unknown) => e instanceof LibraryError && e.status === status;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vods-"));

test("sf6Paths: override da env, default sotto data/vods e nella cartella temporanea", () => {
  assert.deepEqual(sf6Paths(asEnv({ STUDYBUDDY_VODS_DIR: "/v", STUDYBUDDY_UPLOAD_DIR: "/u" })), { vods: "/v", uploads: "/u" });
  const d = sf6Paths(asEnv({}));
  assert.equal(d.vods, path.resolve("data/vods"));
  assert.equal(d.uploads, path.join(os.tmpdir(), "studybuddy-uploads"));
});

test("listVods: solo file multimediali, i più recenti prima; cartella creata se manca", async () => {
  fs.writeFileSync(path.join(dir, "vecchio.mp4"), "x");
  fs.utimesSync(path.join(dir, "vecchio.mp4"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  fs.writeFileSync(path.join(dir, "nuovo.mp3"), "xy");
  fs.writeFileSync(path.join(dir, "note.txt"), "no");
  fs.mkdirSync(path.join(dir, "sotto.mkv"));
  assert.deepEqual((await listVods(dir)).map((v) => v.filename), ["nuovo.mp3", "vecchio.mp4"]);
  const nuova = path.join(dir, "non-ancora");
  assert.deepEqual(await listVods(nuova), []);
  assert.ok(fs.existsSync(nuova));
});

test("resolveMedia: solo nomi dentro la cartella, estensioni ammesse, 404 se manca", () => {
  assert.equal(resolveMedia(dir, "nuovo.mp3", "manca"), path.join(dir, "nuovo.mp3"));
  assert.equal(resolveMedia(dir, "../../nuovo.mp3", "manca"), path.join(dir, "nuovo.mp3"));
  assert.throws(() => resolveMedia(dir, "../../etc/passwd", "manca"), err(400));
  assert.throws(() => resolveMedia(dir, "assente.mp4", "manca"), (e) => err(404)(e) && (e as Error).message === "manca");
  assert.throws(() => resolveMedia(dir, "sotto.mkv", "manca"), err(404));
  assert.throws(() => resolveMedia(dir, 42, "manca"), err(400));
});

test("saveUpload: salva i byte con un id casuale, rifiuta estensioni e dimensioni fuori limite", async () => {
  const up = fs.mkdtempSync(path.join(os.tmpdir(), "sb-up-"));
  const bytes = Buffer.alloc(3000, 7);
  const r = await saveUpload(new File([bytes], "Guida finale.MP4"), up);
  assert.match(r.upload_id, /^[0-9a-f]{16}\.mp4$/);
  assert.equal(r.filename, "Guida finale.MP4");
  assert.deepEqual(fs.readFileSync(path.join(up, r.upload_id)), bytes);
  await assert.rejects(saveUpload(new File([bytes], "x.exe"), up), err(400));
  await assert.rejects(saveUpload(new File([bytes], "x.mp3"), up, 100), err(413));
});

test("youtube: riconoscimento URL, VTT ripulito e senza righe ripetute, errori yt-dlp leggibili", () => {
  assert.equal(isYoutubeUrl("https://www.youtube.com/watch?v=abcdef123"), true);
  assert.equal(isYoutubeUrl("https://youtu.be/abcdef123"), true);
  assert.equal(isYoutubeUrl("https://www.twitch.tv/videos/1"), false);
  const vtt = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:02.000\n<c>ciao</c> &amp; benvenuti\n\n00:00:02.000 --> 00:00:03.000\nciao &amp; benvenuti\n\n00:00:03.000 --> 00:00:04.000\noggi <00:00:03.500>Ryu\n";
  assert.equal(parseVtt(vtt), "ciao & benvenuti oggi Ryu");
  assert.equal(decodeYtDlpFailure(1, "", "ERROR: Private video"), "Video privato.");
  assert.equal(decodeYtDlpFailure(0, "", ""), "Nessun transcript trovato. Il video non ha sottotitoli en.");
});

test("URL per yt-dlp: solo http(s), mai qualcosa che sembri un'opzione", () => {
  assert.equal(assertHttpUrl(" https://www.twitch.tv/videos/1 "), "https://www.twitch.tv/videos/1");
  assert.throws(() => assertHttpUrl("--exec=rm -rf ~"), err(400));
  assert.throws(() => assertHttpUrl("file:///etc/passwd"), err(400));
  assert.throws(() => assertHttpUrl("non è un url"), err(400));
});

test("exclusive: una trascrizione alla volta, la seconda ⇒ 409; lo slot si libera anche dopo un errore", async () => {
  const slow = exclusive(() => new Promise<string>((r) => setTimeout(() => r("a"), 50)));
  await assert.rejects(exclusive(async () => "b"), err(409));
  assert.equal(await slow, "a");
  await assert.rejects(exclusive(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await exclusive(async () => "c"), "c");
});

test("exclusive: il 409 dice da quanto è in corso la trascrizione", async () => {
  const slow = exclusive(() => new Promise<string>((r) => setTimeout(() => r("a"), 30)));
  await assert.rejects(exclusive(async () => "b"), (e: unknown) => e instanceof LibraryError && e.status === 409 && /in corso \(da /.test(e.message));
  await slow;
});

test("saveUpload: cancella gli upload più vecchi di 24 ore, lascia i recenti", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-old-"));
  const old = path.join(dir, "vecchio.mp3");
  const fresh = path.join(dir, "recente.mp3");
  fs.writeFileSync(old, "x");
  fs.writeFileSync(fresh, "x");
  const twoDays = new Date(Date.now() - 48 * 3600_000);
  fs.utimesSync(old, twoDays, twoDays);
  await saveUpload(new File([new Uint8Array([1, 2, 3])], "a.mp3"), dir);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});
