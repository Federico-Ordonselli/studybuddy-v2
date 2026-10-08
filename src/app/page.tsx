import { redirect } from "next/navigation";
import { getLibrary } from "@/lib/library";

export const dynamic = "force-dynamic";

// Provvisorio: la Libreria vera arriva nel task successivo.
export default function Home() {
  const lib = getLibrary();
  const first = lib.macros[0]?.id ?? lib.loose[0]?.id;
  if (first != null) redirect(`/study/${first}`);
  return <p className="p-8 text-fg-dim">Nessun corso.</p>;
}
