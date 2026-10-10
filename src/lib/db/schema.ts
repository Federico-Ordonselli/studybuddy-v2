import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Domini di studio. Gerarchia a due livelli: un dominio `macro` (la specializzazione,
 * es. una specializzazione) raggruppa N domini `course` (i micro-corsi), via
 * `parentId`. I documenti stanno sempre sui domini `course` (foglie).
 */
export const domains = sqliteTable("domains", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parent_id"),                   // macro → micro (self-ref, no FK per evitare cicli)
  kind: text("kind").notNull().default("course"),   // macro | course
  path: text("path"),                               // cartella sorgente su disco
  // Slug dei domini (tabella `areas`) a cui appartiene: SOLO organizzazione, nessun effetto su retrieval/ripasso/mappe.
  areas: text("areas", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Domini dell'hub («Domini» in UI): raggruppano corsi e, da F3, note. `domains.areas`
 * contiene i loro slug. `slug` non cambia dopo la creazione (rinominare cambia `name`).
 * `module` = nome di un modulo registrato in lib/modules.ts, o null.
 */
export const areas = sqliteTable("areas", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  symbol: text("symbol").notNull().default("·"),
  module: text("module"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Note della quick capture. Al più uno tra `domain` (slug di `areas`) e `courseId`
 * (`domains.id`, anche un macro); nessuno dei due = inbox. Niente FK: valida lib/notes.ts.
 */
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  domain: text("domain"),
  courseId: integer("course_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/** Materiale ingerito: PDF, trascrizione, HTML, video. */
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  domainId: integer("domain_id").references(() => domains.id),
  title: text("title").notNull(),
  source: text("source"),                          // url o path su disco
  kind: text("kind").notNull().default("text"),    // text | transcript | pdf | html | video
  meta: text("meta", { mode: "json" }),            // { course, module, lesson, order, videoPath? }
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Ogni file elaborato da `ingestCourse`, anche quelli che non producono documenti
 * (vuoti o con chunk tutti duplicati). L'analisi dell'import confronta gli hash con
 * questa tabella: con i soli `documents` quei file risulterebbero "nuovi" per sempre.
 */
export const ingestedFiles = sqliteTable("ingested_files", {
  domainId: integer("domain_id").notNull().references(() => domains.id),
  source: text("source").notNull(),
  fileHash: text("file_hash").notNull(),
}, (t) => [primaryKey({ columns: [t.domainId, t.source] })]);

/** Chunk di testo. L'embedding vive nella virtual table sqlite-vec (vec_chunks). */
export const chunks = sqliteTable("chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  meta: text("meta", { mode: "json" }), // { startSec?, endSec? } per trascrizioni
});

/** Carte per lo spaced repetition (SM-2). */
export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  domainId: integer("domain_id").references(() => domains.id),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sourceChunkId: integer("source_chunk_id").references(() => chunks.id),
  suspended: integer("suspended", {mode:"boolean"}).notNull().default(false),
  // stato SM-2
  ease: real("ease").notNull().default(2.5),
  intervalDays: integer("interval_days").notNull().default(0),
  repetitions: integer("repetitions").notNull().default(0),
  dueAt: integer("due_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/** Sessioni del tutor (loop stile Coursera). */
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  domainId: integer("domain_id").references(() => domains.id),
  mode: text("mode").notNull().default("socratic"), // socratic | quiz | review
  state: text("state", { mode: "json" }),           // stato serializzato della macchina a stati
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()), // ultimo turno salvato (home: «ultimi corsi studiati»)
});

/**
 * Mappe concettuali esplorabili (editor in components/mappe). `doc` è il documento
 * v1 completo (concetti, tele annidate, relazioni): la struttura la valida
 * `lib/mappe/formato-mappa.js`, qui serve solo l'indice per dominio e la revisione.
 */
export const conceptMaps = sqliteTable("concept_maps", {
  id: text("id").primaryKey(),
  domainId: integer("domain_id").references(() => domains.id),
  title: text("title").notNull(),
  revision: integer("revision").notNull().default(0),
  doc: text("doc", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Modulo SF6 (codice in F5, da `learning-vault@439b105`): combo e consigli per personaggio,
 * con le colonne del vault. Le tabelle nascono in F4 perché l'import del vault le popola.
 * `character_slug` è una stringa: il roster sta nel codice del modulo.
 */
export const sf6Combos = sqliteTable("sf6_combos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterSlug: text("character_slug").notNull(),
  notation: text("notation").notNull(),
  situation: text("situation"),
  status: text("status").notNull().default("learning"), // learning | practicing | consolidated
  damage: integer("damage"),
  driveCost: integer("drive_cost"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const sf6Tips = sqliteTable("sf6_tips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterSlug: text("character_slug").notNull(),
  type: text("type").notNull(), // combo | tech | strategy | matchup | general
  title: text("title").notNull(),
  content: text("content").notNull(),
  notation: text("notation"),
  sourceTitle: text("source_title"),
  sourceUrl: text("source_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
