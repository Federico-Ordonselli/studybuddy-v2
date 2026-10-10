/** Decodifica UTF-8 anche quando una riga o un carattere attraversa più pacchetti. */
export async function* decodedLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const {value, done} = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, {stream:true});
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        yield pending.slice(0,end).replace(/\r$/, "");
        pending = pending.slice(end+1);
      }
      if (done) break;
    }
    if (pending) yield pending;
  } finally { await reader.cancel(); reader.releaseLock(); }
}
