// FontAwesome Free Solid "hand" icon (CC BY 4.0)
// 帰属表示: フッターに「Hand icon by Font Awesome (CC BY 4.0)」を記載
import { faHand } from "@fortawesome/free-solid-svg-icons";
import { Texture } from "pixi.js";

let cachedTexture: Texture | null = null;
let loadingPromise: Promise<Texture> | null = null;

/**
 * FA hand アイコンの SVG パスを 1 枚の白い PIXI.Texture にロードする。
 * 色付けは PIXI.Sprite の tint で動的にやる(GPU 任せ、軽い)。
 * SVG → HTMLImageElement → Canvas → PIXI.Texture の順でラスタライズ。
 * 結果はモジュール内でキャッシュ、複数回の呼び出しでも 1 枚しかロードしない。
 */
export async function getHandTexture(): Promise<Texture> {
  if (cachedTexture) return cachedTexture;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [iconW, iconH, , , pathData] = faHand.icon;
    const path = Array.isArray(pathData) ? pathData.join(" ") : pathData;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconW} ${iconH}"><path fill="#ffffff" d="${path}"/></svg>`;
    const dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent(svg);

    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("hand SVG load failed"));
    });

    // Canvas にラスタライズ。PIXI.Sprite 側でスケール・tint するので解像度は固定でOK
    const renderSize = 256;
    const scale = renderSize / Math.max(iconW, iconH);
    const w = Math.max(1, Math.round(iconW * scale));
    const h = Math.max(1, Math.round(iconH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context not available");
    ctx.drawImage(img, 0, 0, w, h);

    cachedTexture = Texture.from(canvas);
    return cachedTexture;
  })();

  return loadingPromise;
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
