/* Tipi minimi per l'host React: il modulo è JS puro (montabile anche fuori da Next). */
export interface MapDoc { id: string; title: string; revision: number; [key: string]: unknown }
export interface MapStatus { dirty: boolean; saving: boolean; revision: number; changeVersion: number; canUndo: boolean; canRedo: boolean; ui: { spaceId: string; selectedPlacementId: string | null } }
export interface SourceRef { documentId: string; documentRevision: string; chunkId: string; start?: number; end?: number; excerpt?: string }
export interface ConceptRequest { mapId: string; conceptIds: string[]; concepts: { title: string; definition: string }[] }
export interface ExpandRequest { mapId: string; conceptId: string; concept: { title: string; definition: string }; path: string[]; existing: string[]; present: string[] }
export interface Proposal { concepts: unknown[]; relations: { from: string; to: string; label: string }[] }
export interface MapEvent { type: string; document?: MapDoc; status?: MapStatus; [key: string]: unknown }
export interface Adapters {
  saveDocument?: (document: MapDoc, expectedRevision: number) => Promise<MapDoc>;
  resolveSource?: (ref: SourceRef) => Promise<unknown>;
  requestQuiz?: (request: ConceptRequest) => Promise<string | void>;
  askTutor?: (request: ConceptRequest) => Promise<string | void> | void;
  expandConcept?: (request: ExpandRequest) => Promise<Proposal>;
}
export interface MapEditor {
  getDocument(): MapDoc;
  getStatus(): MapStatus;
  loadDocument(document: MapDoc): void;
  focusConcept(conceptId: string): boolean;
  save(): Promise<MapDoc>;
  exportSvg(): string;
  subscribe(listener: (event: MapEvent) => void): () => void;
  destroy(): void;
}
export function mount(container: HTMLElement, options: { document: MapDoc; adapters?: Adapters; readOnly?: boolean; onEvent?: (event: MapEvent) => void }): MapEditor;
