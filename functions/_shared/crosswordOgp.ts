// クロスワードのシェア画像（1200×630 の PNG）。保存の受付係が置き、/crossword/<番号> の受付係が住所を教える。
// 画像はブラウザの canvas で描いたもの（src/lib/crossword/shareImage.ts）。ここでは描かない。

export const OGP_BUCKET = "crossword-ogp";
export const OGP_WIDTH = 1200;
export const OGP_HEIGHT = 630;
/** 置き場の上限（file_size_limit 307200）と同じ */
export const OGP_MAX_BYTES = 307200;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 公開の住所。置けていなければこの住所は 404 になる */
export function ogpPublicUrl(supabaseUrl: string, id: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${OGP_BUCKET}/${id}.png`;
}

/**
 * base64（"data:image/png;base64," が付いていてもよい）を読み、
 * PNG の頭の印・最初の塊が IHDR・幅と高さが 1200×630・大きさが上限以内、のときだけバイト列を返す。だめなら null。
 */
export function decodeOgpPng(input: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof input !== "string" || input === "") return null;
  const b64 = input.startsWith("data:image/png;base64,") ? input.slice("data:image/png;base64,".length) : input;
  // base64 の長さから先に上限を見る（大きすぎる物を展開しない）
  if (b64.length > Math.ceil(OGP_MAX_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length < 24 || bin.length > OGP_MAX_BYTES) return null;
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  for (let i = 0; i < PNG_SIG.length; i++) if (bytes[i] !== PNG_SIG[i]) return null;
  // 8〜11 は IHDR の長さ（13）、12〜15 は "IHDR"、16〜19 が幅、20〜23 が高さ（どちらも大きい桁が先）
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  if (u32(8) !== 13) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  if (u32(16) !== OGP_WIDTH || u32(20) !== OGP_HEIGHT) return null;
  return bytes;
}

/** 秘密の鍵で置き場に置く。置けたら true。失敗しても投げない */
export async function uploadOgpPng(
  supabaseUrl: string,
  secretKey: string,
  id: string,
  png: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${OGP_BUCKET}/${id}.png`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "image/png",
        "x-upsert": "false",
      },
      body: png,
    });
    if (!res.ok) console.error("crossword-ogp: upload failed", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.error("crossword-ogp: upload threw", String(e));
    return false;
  }
}
