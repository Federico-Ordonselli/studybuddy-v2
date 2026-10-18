import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryError } from "./errors";
import { LIBRARY_DIR } from "./libraryDir";
import { realInsideRoot } from "./fsRoot";
import { run, venvBin } from "./proc";

export interface CourseraDownloadJob {
  id: string; slug: string; status: "running" | "done" | "error";
  path?: string; error?: string; warning?: string;
}
const state = globalThis as typeof globalThis & { courseraDownload?: CourseraDownloadJob };

export function parseCourseraUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new LibraryError("Inserisci un link Coursera valido.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new LibraryError("Inserisci un link Coursera valido."); }
  const match = /^\/learn\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== "https:" || !["coursera.org", "www.coursera.org"].includes(url.hostname)
    || url.username || url.password || url.port || !match || match[1].length > 180)
    throw new LibraryError("Usa il link https://www.coursera.org/learn/nome-corso.");
  return match[1];
}

export function currentDownload() { return state.courseraDownload ?? null; }

export function startDownload(input: Record<string, unknown>): CourseraDownloadJob {
  const slug = parseCourseraUrl(input.url);
  const cauth = typeof input.cauth === "string" ? input.cauth.trim() : "";
  const auth = input.auth ?? "manual";
  if (auth !== "manual" && auth !== "firefox") throw new LibraryError("Metodo di accesso non valido.");
  if (auth === "manual" && (!cauth || cauth.length > 16384 || /[\s\x00-\x1f\x7f]/.test(cauth)))
    throw new LibraryError("Inserisci il valore del cookie CAUTH della tua sessione Coursera.");
  if (state.courseraDownload?.status === "running") throw new LibraryError("C’è già un download Coursera in corso.", 409);
  const source = path.resolve(/* turbopackIgnore: true */ process.cwd(),
    process.env.STUDYBUDDY_COURSERA_DIR ?? "courseradown/Coursera-Downloader");
  if (!fs.existsSync(path.join(source, "extractors.py")))
    throw new LibraryError("Motore Coursera non trovato. Configura STUDYBUDDY_COURSERA_DIR.", 503);
  if (!realInsideRoot(LIBRARY_DIR)) throw new LibraryError("Cartella libreria fuori dalla root consentita.", 403);
  const target = path.join(LIBRARY_DIR, slug);
  if (fs.existsSync(target)) throw new LibraryError("Il corso è già nella libreria: importalo dalla cartella esistente.", 409);
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  fs.accessSync(LIBRARY_DIR, fs.constants.W_OK);
  const job: CourseraDownloadJob = { id: randomUUID(), slug, status: "running" };
  state.courseraDownload = job;
  void download(job, source, target, auth, auth === "manual" ? cauth : "");
  return job;
}

async function download(job: CourseraDownloadJob, source: string, target: string, auth: "manual" | "firefox", cauth: string) {
  let staging: string | undefined;
  try {
    staging = await fs.promises.mkdtemp(path.join(LIBRARY_DIR, ".studybuddy-download-"));
    const script = path.resolve(/* turbopackIgnore: true */ process.cwd(), "scripts/coursera_download.py");
    const result = await run(process.env.STUDYBUDDY_COURSERA_PYTHON ?? venvBin("python3"),
      [script, source, job.slug, staging], {
        timeoutMs: 24 * 60 * 60 * 1000,
        env: { ...process.env, STUDYBUDDY_CAUTH: cauth, STUDYBUDDY_COURSERA_AUTH: auth, PYTHONDONTWRITEBYTECODE: "1" },
      });
    if (result.code !== 0) {
      // Solo codici noti: stderr del motore può contenere cookie o URL firmati.
      const code = /^Download fallito: ([a-z-]+)\s*$/.exec(result.stderr)?.[1];
      const messages: Record<string, string> = {
        "firefox-session": "Sessione Coursera non trovata in Firefox. Accedi a Coursera in Firefox e verifica il percorso dei profili (FIREFOX_PROFILES_DIR in Docker), oppure usa CAUTH manualmente.",
        dependencies: "Dipendenze del downloader mancanti. Installa scripts/requirements-coursera.txt nell’interprete STUDYBUDDY_COURSERA_PYTHON; in Docker ricostruisci l’immagine.",
        access: "Coursera ha rifiutato l’accesso (401/403). Rinnova la sessione Firefox o CAUTH e verifica di avere accesso al corso.",
        network: "Impossibile contattare Coursera. Verifica la connessione e riprova.",
        http: "Coursera ha restituito un errore HTTP. Verifica il link del corso e riprova.",
        syllabus: "Il motore non ha recuperato il programma completo del corso. Verifica l’accesso al corso e la compatibilità del downloader.",
        resources: "Alcuni materiali del corso non sono stati scaricati. Rinnova la sessione e riprova: il corso parziale non è stato pubblicato.",
        filesystem: "Il downloader non riesce a leggere o scrivere i file. Verifica permessi dei profili Firefox, libreria e spazio disponibile.",
      };
      if (code && messages[code]) job.error = messages[code];
      throw new Error("download failed");
    }
    const course = path.join(staging, job.slug);
    if (!fs.existsSync(course) || !fs.readdirSync(course).length) throw new Error("empty course");
    // Pubblicazione sullo stesso filesystem: i file parziali restano nascosti alla libreria.
    if (fs.existsSync(target)) throw new Error("course already exists");
    await fs.promises.rename(course, target);
    job.path = target;
    if (result.stdout.trim() === "Download parziale: syllabus")
      job.warning = "Download parziale: Coursera non ha reso disponibili alcuni materiali. Puoi importare quelli scaricati; verifica sul sito le letture e le lezioni mancanti.";
    job.status = "done";
  } catch {
    job.status = "error";
    job.error ??= auth === "firefox"
      ? "Download non completato. Accedi a Coursera in Firefox e verifica che StudyBuddy possa leggere il profilo (in Docker serve il mount Firefox). Puoi anche usare CAUTH manualmente. Verifica inoltre accesso al corso, dipendenze Python e spazio disponibile."
      : "Download non completato. Verifica dipendenze Python, cookie CAUTH, accesso al corso e spazio disponibile.";
  } finally {
    if (staging) await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
