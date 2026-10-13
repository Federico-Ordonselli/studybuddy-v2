import { OllamaUnavailableError } from '@/lib/errors';
import { publicHint } from './hints';
import { prepareSocratic } from './session';
import { beginTurn, endTurn, forModel, saveState, type SessionRow, type SocraticAction } from './sessions';

/** La cronologia viene salvata solo quando il provider ha terminato con successo. I turni a rischio arrivano come un solo token, già controllati. */
export async function socraticResponse(session: SessionRow, message: string, domainId: number | undefined, requestSignal: AbortSignal, action: SocraticAction = 'reply'): Promise<Response> {
  const hint = beginTurn(session.state, message, action); // 409 prima di aprire lo stream
  const abort = new AbortController();
  const onAbort = () => abort.abort(requestSignal.reason);
  requestSignal.addEventListener('abort', onAbort, {once:true});
  if (requestSignal.aborted) onAbort();
  const history = session.state?.history ?? [];
  let prepared;
  try { prepared = await prepareSocratic(forModel(history), message, domainId, hint, action, abort.signal); }
  catch (e) { requestSignal.removeEventListener('abort', onAbort); throw e; }
  const {citations} = prepared;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        abort.signal.throwIfAborted();
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let reply = '';
      let blocked = 0;
      try {
        emit('metadata', {citations, sessionId:session.id, guarded:prepared.guarded, hint:publicHint(hint)});
        if (prepared.guarded) {
          const r = await prepared.reply();
          reply = r.reply; blocked = r.blocked;
          emit('token', {text:reply});
        } else {
          for await (const token of prepared.tokens) { reply += token; emit('token', {text:token}); }
        }
        abort.signal.throwIfAborted();
        const next = endTurn(session.state, hint, action, message, reply, citations, blocked);
        saveState(session.id, next);
        emit('done', {hint:publicHint(next.hint!)});
        controller.close();
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error('[chat stream]',e);
          emit('error', {error:e instanceof OllamaUnavailableError ? 'Ollama non raggiungibile' : 'Generazione interrotta. Riprova.',status:e instanceof OllamaUnavailableError?503:500});
          controller.close();
        } else {
          try { controller.error(e); } catch { /* lettore già cancellato */ }
        }
      } finally { requestSignal.removeEventListener('abort',onAbort); }
    },
    cancel() { abort.abort(); requestSignal.removeEventListener('abort',onAbort); },
  });
  return new Response(stream, {headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform'}});
}
