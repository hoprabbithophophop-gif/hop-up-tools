// FontAwesome Free Solid "hand" icon (CC BY 4.0)
// 帰属表示: フッターに「Hand icon by Font Awesome (CC BY 4.0)」を記載
import { faHand, faExclamation } from "@fortawesome/free-solid-svg-icons";
import { Texture } from "pixi.js";

let cachedTexture: Texture | null = null;
let cachedOutline: { texture: Texture; anchorX: number; anchorY: number } | null = null;
let cachedMark: Texture | null = null;
let cachedMarkOutline: { texture: Texture; anchorX: number; anchorY: number } | null = null;

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
 * 「！」テクスチャ。✋とまったく同じ作り方（FontAwesome のパスを Path2D で直接描画）で、
 * 形だけ exclamation に差し替えたもの。コール情報集約センターで使う。
 * ✋側の関数には一切手を触れていないので、ハイ！テンションの見た目は変わらない。
 */
export function getMarkTexture(): Texture {
  if (cachedMark) return cachedMark;
  cachedMark = buildBubble(false);
  return cachedMark;
}

/** 吹き出しの白フチ版（自分のぶんを群衆から見分けるため）。✋版と同じ考え方。 */
export function getMarkOutlineTexture(): { texture: Texture; anchorX: number; anchorY: number } {
  if (cachedMarkOutline) return cachedMarkOutline;
  const pad = 14;
  // キャンバスは四方に pad を足した (256+pad*2) 角。基準点は「中身の下端中央」＝
  // 色付き本体(anchor 0.5,1.0)とぴったり重なる位置を、✋の白フチ版と同じ式で逆算する。
  // （固定値 0.5,1.0 だと余白ぶん白フチが上にずれて重なり、塗りが遅れて見える）
  return (cachedMarkOutline = {
    texture: buildBubble(true, pad),
    anchorX: (pad + 256 / 2) / (256 + pad * 2),
    anchorY: (pad + 256) / (256 + pad * 2),
  });
}

/**
 * 「！」の入った吹き出しを1枚の絵にする。
 *
 * 色は Pixi の tint で塗るので、絵は白一色のシルエットで作る。
 * 「！」は塗らずに“穴”として抜く（destination-out）。こうすると tint で吹き出しが塗られ、
 * 「！」の部分だけ背景が透けて、吹き出しの中に！が入って見える。
 * しっぽは下向き（席の位置＝下端中央から生えているように見せる）。
 */
function buildBubble(outline: boolean, pad = 0): Texture {
  const W = 256;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W + pad * 2;
  canvas.height = H + pad * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context not available");
  ctx.translate(pad, pad);

  // 吹き出しの本体（角の丸い四角）としっぽ
  const bw = 208;
  const bh = 158;
  const bx = (W - bw) / 2;
  const by = 8;
  const r = 34;
  const tailW = 34;
  const tailH = 42;

  const body = new Path2D();
  body.moveTo(bx + r, by);
  body.lineTo(bx + bw - r, by);
  body.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  body.lineTo(bx + bw, by + bh - r);
  body.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  // しっぽ（下端中央から下へ）
  body.lineTo(W / 2 + tailW / 2, by + bh);
  body.lineTo(W / 2, by + bh + tailH);
  body.lineTo(W / 2 - tailW / 2, by + bh);
  body.lineTo(bx + r, by + bh);
  body.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  body.lineTo(bx, by + r);
  body.quadraticCurveTo(bx, by, bx + r, by);
  body.closePath();

  ctx.fillStyle = "#ffffff";
  if (outline) {
    // フチ版は同じ形を太いストロークで膨らませる（✋の白フチと同じ考え方）
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 26;
    ctx.lineJoin = "round";
    ctx.stroke(body);
  }
  ctx.fill(body);

  // 「！」を穴として抜く
  const [iconW, iconH, , , pathData] = faExclamation.icon;
  const path = Array.isArray(pathData) ? pathData.join(" ") : pathData;
  const markH = 104;
  const s = markH / iconH;
  ctx.globalCompositeOperation = "destination-out";
  ctx.save();
  ctx.translate(W / 2 - (iconW * s) / 2, by + bh / 2 - markH / 2);
  ctx.scale(s, s);
  ctx.fill(new Path2D(path));
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  return Texture.from(canvas);
}

/** 縦に細い「！」でも潰れないよう、幅の狭いアイコンは横に余白を足して正方形に近づける */
function buildIconTexture(icon: typeof faHand): Texture {
  const [iconW, iconH, , , pathData] = icon.icon;
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
  return Texture.from(canvas);
}

function buildIconOutlineTexture(icon: typeof faHand): { texture: Texture; anchorX: number; anchorY: number } {
  const [iconW, iconH, , , pathData] = icon.icon;
  const path = Array.isArray(pathData) ? pathData.join(" ") : pathData;
  const renderSize = 256;
  const scale = renderSize / Math.max(iconW, iconH);
  const w = Math.max(1, Math.round(iconW * scale));
  const h = Math.max(1, Math.round(iconH * scale));

  const strokeIcon = 65;
  const pad = Math.ceil((strokeIcon * scale) / 2) + 2;

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

  return {
    texture: Texture.from(canvas),
    anchorX: (pad + w / 2) / (w + pad * 2),
    anchorY: (pad + h) / (h + pad * 2),
  };
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
