import { readJson, badJson, llmError } from "@/lib/http";
import { positiveId, text, quizQuestion } from "@/lib/validation";
import { LibraryError } from "@/lib/errors";
import { socraticResponse } from "@/lib/tutor/stream";
import { NextRequest, NextResponse } from "next/server";
import { socraticTurn, quizTurn, gradeTurn } from "@/lib/tutor/session";
import { appendTurn, forModel, getOrCreateSession, saveState } from "@/lib/tutor/sessions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return badJson();
  try {
  const mode = body.mode ?? "socratic";
  if (!["socratic", "quiz", "review"].includes(mode as string)) throw new LibraryError("mode non valido");
  if (body.stream !== undefined && typeof body.stream !== "boolean") throw new LibraryError("stream deve essere booleano");
  const sessionId = positiveId(body.sessionId, "sessionId");

  const domainId = positiveId(body.domainId, "domainId");
    if (mode === "socratic") {
      const message = text(body.message, "message");
      // Stato conversazione persistito in sessions.state (single source of truth).
      const session = await getOrCreateSession("socratic", domainId, sessionId);
      if (body.stream === true) return await socraticResponse(session, message, domainId, req.signal);
      const history = session.state?.history ?? [];
      const turn = await socraticTurn(forModel(history), message, domainId);
      saveState(session.id, { history: appendTurn(history, message, turn.reply, turn.citations) });
      return NextResponse.json({ ...turn, sessionId: session.id });
    }
    if (mode === "quiz") {
      return NextResponse.json(await quizTurn(text(body.topic ?? body.message, "message"), domainId));
    }
    if (mode === "review") {
      // body.question = QuizQuestion, body.answer = string
      return NextResponse.json(await gradeTurn(quizQuestion(body.question), text(body.answer, "answer")));
    }
    return NextResponse.json({ error: "mode non valido" }, { status: 400 });
  } catch (e) {
    return llmError(e);
  }
}
