/**
 * 本文を読む前に、Content-Length の申告が上限を超えていれば 413 で断る。
 * ヘッダが無い（分割で送られてくる）ときは今までどおり読む。
 */
export function tooLarge(request: Request, maxBytes: number): Response | null {
  const declared = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(declared) || declared <= maxBytes) return null;
  return new Response(JSON.stringify({ ok: false, reason: "bad_request" }), {
    status: 413,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
