import fs from "node:fs/promises";
import path from "node:path";
import { parseLesson, parseStudy } from "@/lib/studioFormat";

/**
 * Pubblica una lezione della pipeline Full Studio (`content/partN/lesson.json` + `study.json` facoltativo +
 * mp3 in `app/public/audio/partN/`) come pacchetto `<modulo>/studio/` dentro la cartella di un corso della
 * libreria. Solo lettura della sorgente; nella destinazione si scrive solo `studio/` (sostituita per intero:
 * è generata da qui) e, se chiesto, il .md di partenza (mai sovrascritto se diverso).
 */
export interface PackageResult { segments: number; audio: number; missingAudio: number; cards: number; quiz: number; dest: string }

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

export async function publishStudioPackage(opts: { partDir: string; studioRoot: string; moduleDir: string; markdown?: string }): Promise<PackageResult> {
  const lessonRaw = await fs.readFile(path.join(opts.partDir, "lesson.json"), "utf8");
  const lesson = parseLesson(JSON.parse(lessonRaw));
  const studyPath = path.join(opts.partDir, "study.json");
  const studyRaw = (await exists(studyPath)) ? await fs.readFile(studyPath, "utf8") : null;
  const study = studyRaw ? parseStudy(JSON.parse(studyRaw), lesson) : null;

  const audio = lesson.chapters.flatMap((c) => c.sections.flatMap((s) => s.segments.map((g) => g.audio).filter((a): a is string => !!a)));
  for (const rel of audio) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..") || !rel.endsWith(".mp3")) throw new Error(`Percorso audio non valido: ${rel}`);
  }

  await fs.mkdir(opts.moduleDir, { recursive: true });
  if (opts.markdown) {
    const target = path.join(opts.moduleDir, path.basename(opts.markdown));
    const src = await fs.readFile(opts.markdown);
    if (await exists(target)) {
      if (!src.equals(await fs.readFile(target))) throw new Error(`${target} esiste già con un contenuto diverso: non lo sovrascrivo`);
    } else await fs.writeFile(target, src, { flag: "wx" });
  }

  const staging = await fs.mkdtemp(path.join(opts.moduleDir, ".studybuddy-download-studio-"));
  const dest = path.join(opts.moduleDir, "studio");
  const old = `${dest}.old-${process.pid}`;
  let copied = 0;
  let missing = 0;
  try {
    await fs.writeFile(path.join(staging, "lesson.json"), lessonRaw);
    if (studyRaw) await fs.writeFile(path.join(staging, "study.json"), studyRaw);
    for (const rel of new Set(audio)) {
      const from = path.join(opts.studioRoot, "app", "public", rel);
      if (!(await exists(from))) { missing++; continue; }
      const to = path.join(staging, rel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      copied++;
    }
    const had = await exists(dest);
    if (had) await fs.rename(dest, old);
    try {
      await fs.rename(staging, dest);
    } catch (e) {
      if (had) await fs.rename(old, dest);
      throw e;
    }
    if (had) await fs.rm(old, { recursive: true, force: true });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  const sections = Object.values(study?.sections ?? {});
  return {
    segments: audio.length, audio: copied, missingAudio: missing, dest,
    cards: sections.reduce((n, s) => n + (s.cards?.length ?? 0), 0),
    quiz: sections.reduce((n, s) => n + (s.quiz?.length ?? 0), 0) + lesson.chapters.reduce((n, c) => n + (c.quiz?.length ?? 0), 0),
  };
}
