import { notFound } from "next/navigation";
import { LibraryError } from "@/lib/errors";
import { getLesson } from "@/lib/studio";
import StudioPlayer from "@/components/studio/StudioPlayer";

export const dynamic = "force-dynamic";

/** Una lezione Full Studio: il player, con quiz e carte della lezione. */
export default async function StudioLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getLesson>>;
  try {
    data = await getLesson(Number(id));
  } catch (e) {
    if (e instanceof LibraryError && e.status === 404) notFound();
    throw e;
  }
  return <StudioPlayer lessonId={data.id} lesson={data.lesson} course={data.course} initial={data.state} counts={data.counts} />;
}
