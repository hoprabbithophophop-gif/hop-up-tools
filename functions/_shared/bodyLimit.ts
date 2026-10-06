const tooLargeResponse = () =>
  new Response(JSON.stringify({ ok: false, reason: "bad_request" }), {
    status: 413,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const badRequestResponse = () =>
  new Response(JSON.stringify({ ok: false, reason: "bad_request" }), {
    status: 400,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * 本文を読む前に、Content-Length の申告が上限を超えていれば 413 で断る。
 * ヘッダが無い（分割で送られてくる）ときは null（readJsonLimited が読みながら数える）。
 */
export function tooLarge(request: Request, maxBytes: number): Response | null {
  const declared = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(declared) || declared <= maxBytes) return null;
  return tooLargeResponse();
}

/** response が null でなければ、それをそのまま返事にして断る。null なら value が読めた中身 */
export type JsonRead = { value: unknown; response: Response | null };

/**
 * 本文を JSON として読む。Content-Length の申告で先に断り、申告が無い・偽りの送り方でも
 * 読みながらバイト数を数えて、上限を超えた時点で読むのをやめて 413 で断る。
 * JSON として読めなければ 400 bad_request。
 */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<JsonRead> {
  const early = tooLarge(request, maxBytes);
  if (early) return { value: undefined, response: early };
  if (!request.body) return { value: undefined, response: badRequestResponse() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { value: undefined, response: tooLargeResponse() };
      }
      chunks.push(value);
    }
  } catch {
    return { value: undefined, response: badRequestResponse() };
  }

  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(buf)), response: null };
  } catch {
    return { value: undefined, response: badRequestResponse() };
  }
}
