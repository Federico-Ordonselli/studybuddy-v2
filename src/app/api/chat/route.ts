import { NextRequest, NextResponse } from "next/server";
import { socraticTurn, quizTurn, gradeTurn, type TutorMode } from "@/lib/tutor/session";
import { appendTurn, forModel, getOrCreateSession, saveState } from "@/lib/tutor/sessions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const mode: TutorMode = body.mode ?? "socratic";

  const domainId: number | undefined = body.domainId ?? undefined;

  try {
    if (mode === "socratic") {
      // Stato conversazione persistito in sessions.state (single source of truth).
      const session = await getOrCreateSession("socratic", domainId, body.sessionId);
      const history = session.state?.history ?? [];
      const message = body.message ?? "";
      const turn = await socraticTurn(forModel(history), message, domainId);
      saveState(session.id, { history: appendTurn(history, message, turn.reply, turn.citations) });
      return NextResponse.json({ ...turn, sessionId: session.id });
    }
    if (mode === "quiz") {
      return NextResponse.json(await quizTurn(body.topic ?? body.message ?? "", domainId));
    }
    if (mode === "review") {
      // body.question = QuizQuestion, body.answer = string
      return NextResponse.json(await gradeTurn(body.question, body.answer ?? ""));
    }
    return NextResponse.json({ error: "mode non valido" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
