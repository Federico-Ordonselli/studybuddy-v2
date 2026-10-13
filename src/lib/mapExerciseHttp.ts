import { NextResponse } from "next/server";
import { ExerciseError } from "@/lib/mapExercise";

/** Esegue `fn`: ExerciseError → il suo status, altri errori (modello, rete) → 500. */
export async function exerciseResponse(fn: () => unknown): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const status = e instanceof ExerciseError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}

export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
export const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
