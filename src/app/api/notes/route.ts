import { NextRequest } from "next/server";
import { createNote, deleteNote, moveNote } from "@/lib/notes";
import { handle } from "@/lib/http";

export const runtime = "nodejs";

/** Note dell'hub (thin wrapper su lib/notes.ts). Le letture le fanno le pagine lato server. */
export async function POST(req: NextRequest) {
  const { content, domain, courseId } = await req.json();
  return handle(() => ({ note: createNote({ content, domain, courseId }) }));
}

export async function PATCH(req: NextRequest) {
  const { id, domain, courseId } = await req.json();
  return handle(() => ({ note: moveNote(Number(id), { domain, courseId }) }));
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  return handle(() => deleteNote(Number(id)));
}
