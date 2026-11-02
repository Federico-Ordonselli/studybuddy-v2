import fs from "node:fs";
import { Readable } from "node:stream";

/** Risposta con il file intero o la parte chiesta da `Range` (seek di audio/video). Il percorso è già validato dal chiamante. */
export function rangeResponse(file: string, contentType: string, range: string | null): Response {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const stream = (status: number, headers: Record<string, string>, part?: { start: number; end: number }) =>
    new Response(Readable.toWeb(part ? fs.createReadStream(file, part) : fs.createReadStream(file)) as unknown as ReadableStream, { status, headers });
  const base = { "Content-Type": contentType, "Accept-Ranges": "bytes" };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m?.[1] ? parseInt(m[1], 10) : 0;
    let end = m?.[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return stream(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) }, { start, end });
  }
  return stream(200, { ...base, "Content-Length": String(size) });
}
