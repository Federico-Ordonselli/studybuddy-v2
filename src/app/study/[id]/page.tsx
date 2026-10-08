import { notFound } from "next/navigation";
import { getLibrary, getTrail } from "@/lib/library";
import StudyShell, { type StudyTree } from "@/components/study/StudyShell";
import { parseMode } from "@/components/study/modes";

export const dynamic = "force-dynamic";

export default async function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  const n = Number(id);
  const trail = Number.isInteger(n) ? getTrail(n) : null;
  if (!trail) notFound();
  const lib = getLibrary();
  const tree: StudyTree = {
    macros: lib.macros.map((m) => ({ id: m.id, name: m.name, courses: m.courses.map(({ id, name }) => ({ id, name })) })),
    loose: lib.loose.map(({ id, name }) => ({ id, name })),
  };
  return <StudyShell key={trail.id} trail={trail} tree={tree} mode={parseMode(mode)} />;
}
