import { handleAsync } from "@/lib/http";
import { listVods, sf6Paths } from "@/lib/sf6/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** File audio/video nella cartella dei VOD (copiati a mano: niente upload per i file grandi). */
export async function GET() {
  return handleAsync(async () => {
    const dir = sf6Paths().vods;
    return { dir, files: await listVods(dir) };
  });
}
