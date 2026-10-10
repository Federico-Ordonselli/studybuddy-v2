"use client";

import { createPortal } from "react-dom";
import { captureTarget } from "@/lib/client/captureTarget";
import type { ShellData } from "@/lib/home";
import NoteComposer from "./NoteComposer";

/** Pannello «Appunto» sopra la pagina: la destinazione iniziale dipende da dove sei. */
export default function QuickCapture({ data, pathname, onClose }: { data: ShellData; pathname: string; onClose: () => void }) {
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Appunto"
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[15vh] px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl">
        <NoteComposer areas={data.areas} courses={data.courses} initial={captureTarget(pathname, data.areas)} autoFocus onDone={onClose} />
      </div>
    </div>,
    document.body,
  );
}
