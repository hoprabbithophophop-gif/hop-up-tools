// FontAwesome Free Solid "hand" icon (CC BY 4.0)
// 帰属表示: フッターに「Hand icon by Font Awesome (CC BY 4.0)」を記載
import { faHand } from "@fortawesome/free-solid-svg-icons";
import { Texture } from "pixi.js";

let cachedTexture: Texture | null = null;

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
