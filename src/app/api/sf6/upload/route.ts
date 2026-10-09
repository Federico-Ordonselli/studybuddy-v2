import { NextRequest, NextResponse } from "next/server";
import { handleAsync } from "@/lib/http";
import { LibraryError } from "@/lib/errors";
import { uploadRejection } from "@/lib/requestGuard";
import { saveUpload } from "@/lib/sf6/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload di un file audio/video da trascrivere (multipart, campo `file`), da learning-vault@439b105.
 * Fuori dal proxy (vedi src/proxy.ts): i controlli su host, Origin e Content-Type sono qui.
 */
export async function POST(req: NextRequest) {
  const bad = uploadRejection(req);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });
  return handleAsync(async () => {
    const form = await req.formData().catch(() => { throw new LibraryError("Form non valido (atteso multipart/form-data)"); });
    const file = form.get("file");
    if (!(file instanceof File)) throw new LibraryError("Manca il campo 'file'");
    return saveUpload(file);
  });
}
