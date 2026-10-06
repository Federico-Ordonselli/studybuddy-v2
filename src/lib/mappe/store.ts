import { sqlite } from "@/lib/db";
import { assertMapDocument } from "./formato-mappa.js";

/** Documento mappa v1 (validato da formato-mappa.js). */
export type MapDocument = ReturnType<typeof assertMapDocument> & { id: string; title: string; revision: number };
export interface MapSummary { id: string; title: string; revision: number; updatedAt: number }

export class RevisionConflict extends Error {}

let ready = false;
/** Tabella creata on-demand (come FTS/vec): niente db:push obbligatorio. DDL allineato a schema.ts. */
function ensureTable() {
  if (ready) return;
  sqlite.exec(`CREATE TABLE IF NOT EXISTS concept_maps (
    id text PRIMARY KEY NOT NULL,
    domain_id integer REFERENCES domains(id),
    title text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    doc text NOT NULL,
    updated_at integer
  );`);
  ready = true;
}

export function listMaps(domainId: number): MapSummary[] {
  ensureTable();
  return sqlite
    .prepare("SELECT id, title, revision, updated_at AS updatedAt FROM concept_maps WHERE domain_id = ? ORDER BY updated_at DESC")
    .all(domainId) as MapSummary[];
}

export function getMap(id: string): { domainId: number; doc: MapDocument } | null {
  ensureTable();
  const row = sqlite.prepare("SELECT domain_id AS domainId, doc FROM concept_maps WHERE id = ?").get(id) as
    | { domainId: number; doc: string } | undefined;
  return row ? { domainId: row.domainId, doc: JSON.parse(row.doc) } : null;
}

/**
 * Salvataggio con controllo di revisione nella stessa transazione: la revisione
 * attesa deve coincidere con quella in tabella (0 = mappa nuova). Restituisce lo
 * stesso documento con revisione +1, come richiede il contratto dell'editor.
 */
export function saveMap(domainId: number, document: unknown, expectedRevision: number): MapDocument {
  ensureTable();
  const doc = assertMapDocument(document) as MapDocument;
  if (doc.revision !== expectedRevision) throw new RevisionConflict("revisione del documento diversa da quella attesa");
  return sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT revision, domain_id AS domainId FROM concept_maps WHERE id = ?").get(doc.id) as
      | { revision: number; domainId: number } | undefined;
    if ((row?.revision ?? 0) !== expectedRevision) throw new RevisionConflict("la mappa è stata modificata altrove");
    if (row && row.domainId !== domainId) throw new RevisionConflict("la mappa appartiene a un altro dominio");
    const saved = { ...doc, revision: expectedRevision + 1 };
    sqlite.prepare(`INSERT INTO concept_maps (id, domain_id, title, revision, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, revision = excluded.revision, doc = excluded.doc, updated_at = excluded.updated_at`)
      .run(saved.id, domainId, saved.title, saved.revision, JSON.stringify(saved), Math.floor(Date.now() / 1000));
    return saved;
  })();
}

export function deleteMap(id: string) {
  ensureTable();
  sqlite.prepare("DELETE FROM concept_maps WHERE id = ?").run(id);
}
