// A fake R2 bucket for tests: put() DRAINS a stream chunk by chunk and keeps only the first bytes and the size (so a 60 MB
// synthetic video never sits in memory), and records the biggest single chunk it saw. get() supports `range` (a header or offset/length).
export interface Stored { head: Uint8Array; size: number; type: string }
export function fakeR2() {
  const objs = new Map<string, Stored>();
  const stat = { maxChunk: 0, puts: 0, bufferedPuts: 0 };
  const bucket = {
    async put(key: string, body: unknown, o?: { httpMetadata?: { contentType?: string } }) {
      stat.puts++;
      const type = o?.httpMetadata?.contentType || '';
      if (body instanceof ReadableStream) {
        let head = new Uint8Array(0), size = 0;
        const r = body.getReader();
        for (;;) {
          const { done, value } = await r.read(); if (done) break;
          const v = value as Uint8Array; stat.maxChunk = Math.max(stat.maxChunk, v.byteLength);
          if (head.byteLength < 64) { const m = new Uint8Array(Math.min(64, head.byteLength + v.byteLength)); m.set(head); m.set(v.subarray(0, m.byteLength - head.byteLength), head.byteLength); head = m; }
          size += v.byteLength;
        }
        objs.set(key, { head, size, type });
      } else { // a whole buffer was handed over: what the fix removes
        stat.bufferedPuts++;
        const b = new Uint8Array(body as ArrayBuffer); stat.maxChunk = Math.max(stat.maxChunk, b.byteLength);
        objs.set(key, { head: b.slice(0, 64), size: b.byteLength, type });
      }
      return {};
    },
    async get(key: string, o?: { range?: { offset: number; length: number } | Headers }) {
      const s = objs.get(key); if (!s) return null;
      const m = o?.range instanceof Headers ? /bytes=(\d+)-(\d*)/.exec(o.range.get('range') || '') : null;
      const range = m ? { offset: +m[1]!, length: (m[2] ? +m[2] : s.size - 1) - +m[1]! + 1 } : o?.range && !(o.range instanceof Headers) ? o.range : undefined;
      const off = range?.offset ?? 0, len = Math.min(range?.length ?? s.size, s.size - off);
      return { size: s.size, httpEtag: '"e"', httpMetadata: { contentType: s.type }, ...(range ? { range: { offset: off, length: len } } : {}),
        body: new Blob([s.head.slice(off, off + Math.min(len, 64))]).stream() };
    },
    async head(key: string) { const s = objs.get(key); return s ? { size: s.size, httpEtag: '"e"', httpMetadata: { contentType: s.type } } : null; },
    async delete(key: string) { objs.delete(key); },
  };
  return { bucket: bucket as unknown as R2Bucket, objs, stat };
}

// A synthetic file of `size` bytes made lazily in 64 KB chunks (never all at once), starting with `head`
export function synthetic(size: number, head: number[]): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({ pull(c) {
    if (sent >= size) return c.close();
    const n = Math.min(65536, size - sent), b = new Uint8Array(n);
    if (!sent) b.set(head.slice(0, n));
    sent += n; c.enqueue(b);
  } });
}
export const MP4_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];   // ....ftypisom
export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
