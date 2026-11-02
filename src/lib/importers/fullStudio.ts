import fs from "node:fs/promises";
import path from "node:path";

// Solo dati: non importa né esegue codice del progetto sorgente, non apre DB.
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Oggetto Full Studio non valido");
  return value as Obj;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Elenco Full Studio non valido");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Testo Full Studio non valido");
  return value;
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function label(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N} _-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Lezione";
}
const numbered = (index: number, title: string) => `${String(index + 1).padStart(3, "0")}_${label(title)}`;

function blocksHtml(values: unknown, codeBlocks: Obj): string {
  return array(values).map(value => {
    const b = object(value);
    switch (b.type) {
      case "paragraph": return `<p>${escape(string(b.plain ?? b.text))}</p>`;
      case "code": {
        const code = object(codeBlocks[string(b.ref)]);
        return `<p>${escape(typeof code.file === "string" ? code.file : "Codice")}</p><pre><code>${escape(string(code.code))}</code></pre>`;
      }
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${array(b.items).map(value => {
          const item = object(value);
          return `<li>${escape(string(item.plain ?? item.text))}${item.children && array(item.children).length ? blocksHtml([{ type: "list", items: item.children }], codeBlocks) : ""}</li>`;
        }).join("\n")}</${tag}>`;
      }
      case "table": {
        const row = (cells: unknown, tag: string) => `<tr>${array(cells).map(cell => `<${tag}>${escape(string(cell))}</${tag}>`).join("")}</tr>`;
        return `<table>${row(b.plainHeaders ?? b.headers, "th")}${array(b.plainRows ?? b.rows).map(cells => row(cells, "td")).join("\n")}</table>`;
      }
      case "callout": return `<aside>${typeof b.title === "string" ? `<h3>${escape(b.title)}</h3>` : ""}${blocksHtml(b.blocks, codeBlocks)}</aside>`;
      default: throw new Error(`Blocco Full Studio non supportato: ${String(b.type)}`);
    }
  }).join("\n");
}

export interface StudioFile { relativePath: string; html: string }
/** Converte una parte in lezioni HTML native per il normale ingest di StudyBuddy. */
export function convertStudioPart(structureValue: unknown, lessonValue: unknown, partIndex: number): StudioFile[] {
  const structure = object(structureValue);
  const lesson = object(lessonValue);
  const codeBlocks = object(structure.codeBlocks);
  const narrations = new Map<string, { title: string; texts: string[]; chapter: string }>();
  for (const c of array(lesson.chapters)) {
    const chapter = object(c);
    for (const s of array(chapter.sections)) {
      const section = object(s);
      const id = string(section.id);
      if (narrations.has(id)) throw new Error(`Sezione duplicata: ${id}`);
      narrations.set(id, { title: string(section.title), chapter: string(chapter.id), texts: array(section.segments).map(segment => string(object(segment).text)) });
    }
  }
  const files: StudioFile[] = [];
  // I nomi non numerati identificano corsi nel riconoscimento macro della libreria.
  const course = `Corso ${numbered(partIndex, string(lesson.title ?? structure.title))}`;
  for (const [chapterIndex, c] of array(structure.chapters).entries()) {
    const chapter = object(c);
    if (chapter.front === true) continue;
    const chapterId = string(chapter.id);
    const moduleName = numbered(chapterIndex, string(chapter.title));
    const sections: { title: string; body: string }[] = [];
    for (const s of array(chapter.sections)) {
      const section = object(s);
      const id = string(section.id);
      const narration = narrations.get(id);
      const source = blocksHtml(section.blocks, codeBlocks);
      const spoken = narration?.texts.map(text => `<p>${escape(text)}</p>`).join("\n") ?? "";
      sections.push({ title: string(section.title), body: `${source}${spoken ? `\n<h2>Spiegazione della lezione</h2>\n${spoken}` : ""}` });
      narrations.delete(id);
    }
    // Il copione può suddividere una sezione della guida in più sezioni nuove.
    for (const [id, narration] of narrations) {
      if (narration.chapter !== chapterId) continue;
      sections.push({ title: narration.title, body: narration.texts.map(text => `<p>${escape(text)}</p>`).join("\n") });
      narrations.delete(id);
    }
    sections.forEach((section, index) => {
      if (!section.body.trim()) return;
      const title = `${string(chapter.title)} — ${section.title}`;
      files.push({
        relativePath: path.join(course, moduleName, numbered(index, section.title), "lezione.html"),
        html: `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1>${escape(title)}</h1>\n${section.body}\n</body></html>\n`,
      });
    });
  }
  return files;
}

/** Pubblica solo in una cartella nuova: nessuna sovrascrittura dei materiali esistenti. */
export async function prepareStudioLibrary(source: string, destination: string): Promise<{ parts: number; lessons: number }> {
  const content = path.join(source, "content");
  const entries = (await fs.readdir(content, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const files: StudioFile[] = [];
  let parts = 0;
  for (const entry of entries) {
    const dir = path.join(content, entry.name);
    const hasStructure = await fs.stat(path.join(dir, "structure.json")).then(s => s.isFile(), () => false);
    if (!hasStructure) continue;
    const structure = JSON.parse(await fs.readFile(path.join(dir, "structure.json"), "utf8"));
    const lesson = JSON.parse(await fs.readFile(path.join(dir, "lesson.json"), "utf8"));
    files.push(...convertStudioPart(structure, lesson, parts++));
  }
  if (!files.length) throw new Error("Nessuna lezione Full Studio trovata");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  // Staging nello stesso filesystem; link/copie della sorgente non vengono seguiti nell'output.
  const staging = await fs.mkdtemp(path.join(path.dirname(destination), ".studybuddy-download-studio-"));
  try {
    for (const file of files) {
      const target = path.join(staging, file.relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.html, "utf8");
    }
    // mkdir esclusiva protegge anche da due conversioni concorrenti.
    await fs.mkdir(destination);
    try {
      for (const entry of await fs.readdir(staging)) await fs.rename(path.join(staging, entry), path.join(destination, entry));
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return { parts, lessons: files.length };
}
