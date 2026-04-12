/**
 * Cloudflare Pages Function: /ogp/text-svg
 *
 * YouTube サムネに重ねるテキストオーバーレイ SVG を生成する。
 * cf.image.draw の url として使用される。
 *
 * クエリパラメータ:
 *   title  - プレイリスト表示タイトル
 *   desc   - チャプター説明（"〇〇 他N件" 等）
 *
 * SVG は 1200×630 (OGP サイズ) で透明背景。
 * 下部に半透明ダークバーを敷いてテキストを配置する。
 *
 * ⚠️ cf.image.draw は SVG の width/height を上書きしない可能性があるため、
 *    SVG 側で最終サイズを明示している。
 */

const W = 1200;
const H = 630;
const BAR_H = 168;        // 下部テキストバーの高さ
const BAR_Y = H - BAR_H; // バー上端の Y 座標

/** テキストの最大表示文字数（それ以上は省略記号） */
const MAX_TITLE = 38;
const MAX_DESC = 52;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** SVG / XML 属性値のエスケープ */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const rawTitle = url.searchParams.get('title') ?? '';
  const rawDesc = url.searchParams.get('desc') ?? '';

  const title = truncate(rawTitle, MAX_TITLE);
  const desc = truncate(rawDesc, MAX_DESC);

  // フォント: CF の SVG レンダラ（librsvg）で日本語が使えるか不明なため
  // Noto 系フォントを最優先にしたスタック。英字は必ずレンダリングされる。
  const fontStack = 'Noto Sans JP, Noto Sans CJK JP, Noto CJK JP, ' +
    'Hiragino Kaku Gothic Pro, Yu Gothic, Meiryo, Arial, sans-serif';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">

  <!-- 下部テキストバー: 半透明ダーク -->
  <rect x="0" y="${BAR_Y}" width="${W}" height="${BAR_H}"
        fill="rgba(0,0,0,0.70)" rx="0" ry="0"/>

  <!-- タイトル行 -->
  <text x="40" y="${BAR_Y + 58}"
        font-family="${fontStack}"
        font-size="38"
        font-weight="700"
        fill="white"
        dominant-baseline="auto"
  >${esc(title)}</text>

  <!-- 説明行 -->
  <text x="40" y="${BAR_Y + 110}"
        font-family="${fontStack}"
        font-size="26"
        font-weight="400"
        fill="rgba(255,255,255,0.85)"
        dominant-baseline="auto"
  >${esc(desc)}</text>

  <!-- "CHAPTER PICKUP" ブランドラベル（右下） -->
  <text x="${W - 40}" y="${BAR_Y + 144}"
        font-family="Arial, sans-serif"
        font-size="20"
        font-weight="700"
        fill="rgba(255,255,255,0.45)"
        text-anchor="end"
        dominant-baseline="auto"
  >CHAPTER PICKUP</text>

</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // cf.image.draw が SVG を取りに来る際に毎回最新を返す
      'Cache-Control': 'no-store',
    },
  });
}
