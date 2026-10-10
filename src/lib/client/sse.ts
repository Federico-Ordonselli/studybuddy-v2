/** Eventi JSON SSE; conserva frame e caratteri UTF-8 divisi tra pacchetti. */
export async function* decodedSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const {value,done} = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value,{stream:true});
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0,end);
        pending = pending.slice(end+2);
        const event = frame.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const data = frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
        if (data) yield {event, data:JSON.parse(data)};
      }
      if (done) break;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
