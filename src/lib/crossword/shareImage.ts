// シェア画像（1200×630 の PNG）をブラウザの canvas で描く。保存の直前に1回だけ描いて受付係へ送る。
// 中身: 白地に、答えを伏せた盤の枠（解く画面の盤 PuzzleGridRetro と同じ実線・破線）、題名、下の帯に英大文字のラベルで「HOP-UP TOOLS / CROSSWORD」（帯と文言は Hop 決定 2026-10-03）。非公式の表記は描かない（DESIGN.md §1 の例外）。
// 色は DESIGN.md（文字は on-surface・secondary、盤の線は PuzzleGridRetro と同じ灰色）。
import type { GridCell, PuzzleData } from "./types";

export const SHARE_W = 1200;
export const SHARE_H = 630;
/** 置き場の上限（300KB）。超えたら送らない */
export const SHARE_MAX_BYTES = 307200;

const BG = "#ffffff";
const INK = "#191c1d";
const SECONDARY = "#585f6c";
const LINE = "#6b7280"; // PuzzleGridRetro の BORDER_COLOR と同じ
const FONT = "Inter, 'Noto Sans JP', sans-serif";
// 帯にどこの何かを置く
const BAND_LEFT = "HOP-UP TOOLS / CROSSWORD";
const BAND = { h: 64, fill: "#f3f4f5" }; // 下の帯。DESIGN.md の surface-container-low
const CONTENT_H = SHARE_H - BAND.h;

// 盤を置く左の正方形の枠と、題名を置く右の枠【仮】。どちらも帯より上に収める
const BOARD_BOX = { x: 60, y: 28, size: 510 };
const TEXT_BOX = { x: 640, y: 28, w: 500 };
const MAX_CELL = 64;

type Edge = "solid" | "dashed" | null;

// 隣のマスと同じ語に入っていれば破線、別の語なら実線、隣にマスが無ければ（外側）実線。PuzzleGridRetro の calculateBorderStyles と同じ考え方
function edgeStyle(cell: GridCell, adj: GridCell | undefined): Edge {
  if (!adj) return "solid";
  const a = cell.wordIds ?? [];
  const b = adj.wordIds ?? [];
  return a.some((id) => b.includes(id)) ? "dashed" : "solid";
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const next = line + chars[i];
    if (ctx.measureText(next).width > maxWidth && line !== "") {
      lines.push(line);
      line = chars[i];
      if (lines.length === maxLines) {
        // 入りきらない分は「…」で止める
        let last = lines[maxLines - 1];
        while (last.length > 0 && ctx.measureText(last + "…").width > maxWidth) last = Array.from(last).slice(0, -1).join("");
        lines[maxLines - 1] = last + "…";
        return lines;
      }
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 描いた PNG を data URL で返す。描けない・大きすぎるときは null（画像なしで保存を続ける） */
export async function drawShareImage(puzzle: PuzzleData, title: string): Promise<string | null> {
  try {
    if (document.fonts?.load) {
      await Promise.race([
        Promise.all([document.fonts.load(`700 56px ${FONT}`, title), document.fonts.load(`700 20px ${FONT}`, BAND_LEFT)]),
        new Promise((r) => setTimeout(r, 1500)),
      ]).catch(() => {});
    }
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);

    // --- 盤の枠（答えは描かない） ---
    const cell = Math.max(8, Math.min(MAX_CELL, Math.floor(BOARD_BOX.size / Math.max(puzzle.width, puzzle.height, 1))));
    const k = cell / 48; // 解く画面の 1 マス 48px を基準に、線と破線の長さを同じ割合で大きくする
    const ox = BOARD_BOX.x + Math.floor((BOARD_BOX.size - puzzle.width * cell) / 2);
    const oy = BOARD_BOX.y + Math.floor((BOARD_BOX.size - puzzle.height * cell) / 2);
    const map = new Map<string, GridCell>();
    puzzle.cells.forEach((c) => map.set(`${c.x},${c.y}`, c));

    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1, Math.round(k));
    const half = ctx.lineWidth % 2 === 1 ? 0.5 : 0; // 細い線をにじませない
    const line = (x1: number, y1: number, x2: number, y2: number, style: Edge) => {
      if (!style) return;
      ctx.setLineDash(style === "dashed" ? [4 * k, 3 * k] : []);
      ctx.beginPath();
      ctx.moveTo(x1 + half, y1 + half);
      ctx.lineTo(x2 + half, y2 + half);
      ctx.stroke();
    };
    for (const c of puzzle.cells) {
      const x = ox + c.x * cell;
      const y = oy + c.y * cell;
      const top = map.get(`${c.x},${c.y - 1}`);
      const left = map.get(`${c.x - 1},${c.y}`);
      const right = map.get(`${c.x + 1},${c.y}`);
      const bottom = map.get(`${c.x},${c.y + 1}`);
      // 隣どうしで共有する辺は、上と左の辺として1回だけ描く。右と下は外側のときだけ描く
      line(x, y, x + cell, y, edgeStyle(c, top));
      line(x, y, x, y + cell, edgeStyle(c, left));
      if (!right) line(x + cell, y, x + cell, y + cell, "solid");
      if (!bottom) line(x, y + cell, x + cell, y + cell, "solid");
    }
    ctx.setLineDash([]);

    // --- 題名 ---
    ctx.fillStyle = INK;
    ctx.textBaseline = "top";
    ctx.font = `700 56px ${FONT}`;
    const lines = wrapLines(ctx, title, TEXT_BOX.w, 5);
    const lineH = 72;
    const textTop = Math.max(TEXT_BOX.y, Math.floor((CONTENT_H - lines.length * lineH) / 2));
    lines.forEach((l, i) => ctx.fillText(l, TEXT_BOX.x, textTop + i * lineH));

    // --- 下の帯: サイトのラベルと同じ英大文字・字間広めで、どこの何かを置く ---
    ctx.fillStyle = BAND.fill;
    ctx.fillRect(0, CONTENT_H, SHARE_W, BAND.h);
    ctx.fillStyle = SECONDARY;
    ctx.font = `700 20px ${FONT}`;
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "4px";
    ctx.fillText(BAND_LEFT, BOARD_BOX.x, CONTENT_H + BAND.h / 2);

    const url = canvas.toDataURL("image/png");
    const b64 = url.slice(url.indexOf(",") + 1);
    const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    if (bytes > SHARE_MAX_BYTES) return null;
    return url;
  } catch (e) {
    console.warn("share image failed:", e);
    return null;
  }
}
