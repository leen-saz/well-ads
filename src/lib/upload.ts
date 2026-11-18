// Raw-body uploads (the file is the request body). A body without a Content-Length used to be treated as 1 byte by the size check
// and then buffered whole: any editor could make the Worker hold the platform's maximum request size in memory. Now the length must
// be declared, it is checked against the file kind's limit before anything is read, and the body is read through a counter that
// stops at the declared size, so a length that lies cannot fill the isolate either.
export function declaredLength(request: Request): number | null {
  const h = request.headers.get('content-length');
  return h !== null && /^\d{1,12}$/.test(h.trim()) ? Number(h) : null;
}

// The whole body, or null when it runs past `max` bytes (the read stops at once)
export async function readCapped(request: Request, max: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return all.buffer;
}
