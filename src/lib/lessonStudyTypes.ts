import type { Grade } from "@/lib/tutor/grade";

export interface LessonView {
  id: number; courseId: number; title: string; course: string; module: string;
  video: string | null;
}
export interface CornellView {
  documentId: number; revision: number; questions: string[]; answers: string[];
  summary: string; grade: Grade | null; noteId: number | null; partial: boolean;
}
export interface PretestView { questions: string[]; partial: boolean; revision: number }
