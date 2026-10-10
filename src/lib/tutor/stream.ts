import { prepareSocraticStream } from './session';
import { appendTurn, forModel, saveState, type SessionRow } from './sessions';

/** La cronologia viene salvata solo quando il provider ha terminato con successo. */
export async function socraticResponse(session: SessionRow, message: string, domainId: number | undefined, requestSignal: AbortSignal): Promise<Response> {
  const abort = new AbortController();
  const onAbort = () => abort.abort(requestSignal.reason);
  requestSignal.addEventListener('abort', onAbort, {once:true});
  if (requestSignal.aborted) onAbort();
  const history = session.state?.history ?? [];
  let prepared;
  try { prepared = await prepareSocraticStream(forModel(history), message, domainId, abort.signal); }
  catch (e) { requestSignal.removeEventListener('abort', onAbort); throw e; }
  const {citations, tokens} = prepared;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        abort.signal.throwIfAborted();
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let reply = '';
      try {
        emit('metadata', {citations, sessionId:session.id});
        for await (const token of tokens) { reply += token; emit('token', {text:token}); }
        abort.signal.throwIfAborted();
        saveState(session.id, {history:appendTurn(history,message,reply,citations)});
        emit('done', {});
        controller.close();
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error('[chat stream]',e);
          emit('error', {error:'Generazione interrotta. Riprova.'});
          controller.close();
        }
      } finally { requestSignal.removeEventListener('abort',onAbort); }
    },
    cancel() { abort.abort(); requestSignal.removeEventListener('abort',onAbort); },
  });
  return new Response(stream, {headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform'}});
}
