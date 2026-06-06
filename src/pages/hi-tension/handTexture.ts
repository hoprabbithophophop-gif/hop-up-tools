// FontAwesome Free Solid "hand" icon (CC BY 4.0)
// 帰属表示: フッターに「Hand icon by Font Awesome (CC BY 4.0)」を記載
import { faHand } from "@fortawesome/free-solid-svg-icons";
import { Texture } from "pixi.js";

let cachedTexture: Texture | null = null;
let cachedOutline: { texture: Texture; anchorX: number; anchorY: number } | null = null;

/**
 * FA hand アイコンのパスを Canvas に Path2D で直接描画し、PIXI.Texture にする。
 * data: URL + <img> 方式だと Cloudflare の CSP(img-src 'self' のみ) でブロックされるため、
 * Image を経由しない Path2D 直接描画にしている。
 * 色は PIXI.Sprite の tint で動的に変える(GPU 任せで軽い)。
 */
export function getHandTexture(): Texture {
  if (cachedTexture) return cachedTexture;

  const [iconW, iconH, , , pathData] = faHand.icon;
  const path = Array.isArray(pathData) ? pathData.join(" ") : pathData;

  const renderSize = 256;
  const scale = renderSize / Math.max(iconW, iconH);
  const w = Math.max(1, Math.round(iconW * scale));
  const h = Math.max(1, Math.round(iconH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context not available");

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fill(new Path2D(path));

  cachedTexture = Texture.from(canvas);
  return cachedTexture;
}

/**
 * 白フチ版の✋テクスチャ（1回だけ生成してキャッシュ）。
 * 同じ FA hand パスを「白の太いストローク＋白塗り」で描くと、シルエットが一様に膨らんだ
 * 白い手＝縁取りになる。自分の✋は「これを背面に1枚＋色付き本体を前面に1枚」の計2枚で表現でき、
 * 実行時に白スプライトを何枚も重ねる(重い・オーバードロー)必要がなくなる。
 * ストロークが見切れないようキャンバスに余白(pad)を取るため、本体と中身を揃える anchor も返す。
 */
export function getHandOutlineTexture(): { texture: Texture; anchorX: number; anchorY: number } {
  if (cachedOutline) return cachedOutline;

  const [iconW, iconH, , , pathData] = faHand.icon;
  const path = Array.isArray(pathData) ? pathData.join(" ") : pathData;

  const renderSize = 256;
  const scale = renderSize / Math.max(iconW, iconH);
  const w = Math.max(1, Math.round(iconW * scale));
  const h = Math.max(1, Math.round(iconH * scale));

  const strokeIcon = 65; // フチ太さ(アイコン座標系)。自分✋が大きくなったぶん細めに（太すぎ防止）
  const pad = Math.ceil((strokeIcon * scale) / 2) + 2; // ストロークがキャンバス外に見切れないための余白(px)

  const canvas = document.createElement("canvas");
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context not available");

  ctx.translate(pad, pad);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = strokeIcon;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const p = new Path2D(path);
  ctx.stroke(p);
  ctx.fill(p);

  cachedOutline = {
    texture: Texture.from(canvas),
    // 中身(手)の下端中央が、色付き本体(anchor 0.5,1.0)とぴったり重なるよう anchor を逆算
    anchorX: (pad + w / 2) / (w + pad * 2),
    anchorY: (pad + h) / (h + pad * 2),
  };
  return cachedOutline;
}

/**
 * セッションハッシュから (xRatio, yRatio) を決定的に算出。
 * 同じ hash → 同じ位置、別の hash → 別の位置。
 * 戻り値は 0.05〜0.95 の範囲(端っこに張り付かないよう内側に寄せる)。
 */
export function seatFromHash(hash: number): { xRatio: number; yRatio: number } {
  const h = hash >>> 0;
  const a = (Math.imul(h, 2654435761) ^ 0xdeadbeef) >>> 0;
  const b = (Math.imul(h, 1779033703) ^ 0x9e3779b9) >>> 0;
  const xRatio = 0.05 + (a / 0xffffffff) * 0.9;
  const yRatio = 0.05 + (b / 0xffffffff) * 0.9;
  return { xRatio, yRatio };
}
