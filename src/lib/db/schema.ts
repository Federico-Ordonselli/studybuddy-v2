import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";

/**
 * Domini di studio. Gerarchia a due livelli: un dominio `macro` (la specializzazione,
 * es. "Meta Front-End Developer") raggruppa N domini `course` (i micro-corsi), via
 * `parentId`. I documenti stanno sempre sui domini `course` (foglie).
 */
export const domains = sqliteTable("domains", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parent_id"),                   // macro → micro (self-ref, no FK per evitare cicli)
  kind: text("kind").notNull().default("course"),   // macro | course
  path: text("path"),                               // cartella sorgente su disco
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
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
});
