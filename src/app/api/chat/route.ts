import { readJson, badJson, llmError } from "@/lib/http";
import { positiveId, text, quizQuestion } from "@/lib/validation";
import { LibraryError } from "@/lib/errors";
import { socraticResponse } from "@/lib/tutor/stream";
import { NextRequest, NextResponse } from "next/server";
import { socraticTurn, quizTurn, gradeTurn } from "@/lib/tutor/session";
import { beginTurn, endTurn, forModel, problemStatement, getOrCreateSession, saveState, SOLUTION_MESSAGE } from "@/lib/tutor/sessions";
import { initialHint, publicHint, resetProblem } from "@/lib/tutor/hints";

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
      const action = body.action ?? "reply";
      if (!["reply", "solution", "new-problem"].includes(action as string)) throw new LibraryError("action non valida");
      // il messaggio si valida prima di creare la sessione: niente righe orfane per un body sbagliato
      const message = action === "reply" ? text(body.message, "message") : SOLUTION_MESSAGE;
      const session = await getOrCreateSession("socratic", domainId, sessionId);
      if (action === "new-problem") {
        const hint = resetProblem(session.state?.hint ?? initialHint());
        saveState(session.id, { history: session.state?.history ?? [], hint });
        return NextResponse.json({ sessionId: session.id, hint: publicHint(hint) });
      }
      const act = action as "reply" | "solution";
      if (body.stream === true) return await socraticResponse(session, message, domainId, req.signal, act);
      const hint = beginTurn(session.state, message, act);
      const turn = await socraticTurn(forModel(session.state?.history ?? []), message, hint, domainId, act, problemStatement(session.state?.history ?? [], hint.turns));
      const next = endTurn(session.state, hint, act, message, turn.reply, turn.citations, turn.blocked);
      saveState(session.id, next);
      return NextResponse.json({ ...turn, sessionId: session.id, hint: publicHint(next.hint!) });
    }
    if (mode === "quiz") {
      return NextResponse.json(await quizTurn(text(body.topic ?? body.message, "message"), domainId));
    }
    if (mode === "review") {
      // body.question = QuizQuestion, body.answer = string
      return NextResponse.json(await gradeTurn(quizQuestion(body.question), text(body.answer, "answer"), domainId));
    }
    return NextResponse.json({ error: "mode non valido" }, { status: 400 });
  } catch (e) {
    return llmError(e);
  }
}
