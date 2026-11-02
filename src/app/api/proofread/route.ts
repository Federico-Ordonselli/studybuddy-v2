import { NextResponse } from "next/server";
import { cancelProofread, currentProofread, listVaults, NOTES_DIR, startProofread } from "@/lib/proofread/job";
import { badJson, handle, readJson } from "@/lib/http";

export const runtime = "nodejs";

/** Vault disponibili e stato della correzione (polling dal pannello in Impostazioni). */
export async function GET() {
  return NextResponse.json({ vaults: listVaults(), job: currentProofread(), root: NOTES_DIR }, { headers: { "Cache-Control": "no-store" } });
}

/** Avvia la correzione di un vault: `{ vault, force? }`. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return badJson();
  return handle(() => ({ job: startProofread(body) }));
}

/** Interrompe la correzione in corso (le note già fatte restano nella copia). */
export async function DELETE() {
  return handle(() => ({ job: cancelProofread() }));
}
