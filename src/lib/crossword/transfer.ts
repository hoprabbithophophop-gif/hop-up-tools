// 別の端末への引き継ぎ（Hop 決定 2026-10-04）。ログインが無いので、この端末だけにある物を1本の合言葉にして運ぶ。
// 運ぶ物: 自分が作った問題（消すための合言葉を含む）と、ランキングで自分を見分ける番号。
// 合言葉を知っている人は問題を消せるので、人に見せない前提（画面でも知らせる）。
import { readMyPuzzles, type MyPuzzle } from "./puzzleStore";
import { getPlayerKey } from "./scores";

const PREFIX = "CW1-";
const PLAYER_KEY = "crossword_player_key";
const MY_PUZZLES_KEY = "crossword_my_puzzles";

interface Bundle {
  v: 1;
  playerKey: string;
  mine: MyPuzzle[];
}

const toBase64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
};

export function makeTransferCode(): string {
  const bundle: Bundle = { v: 1, playerKey: getPlayerKey(), mine: readMyPuzzles() };
  return PREFIX + toBase64Url(JSON.stringify(bundle));
}

// 合言葉を読んでこの端末に入れる。作った問題は今ある物と合わせる（同じ問題は1つにする）。
// ランキングで自分を見分ける番号は、引き継いだ物に置き換える。読めなければ null
export function applyTransferCode(code: string): { added: number } | null {
  const t = code.trim().replace(/\s+/g, "");
  if (!t.startsWith(PREFIX)) return null;
  let b: Bundle;
  try {
    b = JSON.parse(fromBase64Url(t.slice(PREFIX.length))) as Bundle;
  } catch {
    return null;
  }
  if (!b || b.v !== 1 || typeof b.playerKey !== "string" || !/^[0-9a-f]{64}$/.test(b.playerKey) || !Array.isArray(b.mine)) return null;
  const valid = b.mine.filter(
    (m) =>
      !!m &&
      typeof m.id === "string" &&
      /^[A-Za-z0-9_-]{8}$/.test(m.id) &&
      typeof m.title === "string" &&
      typeof m.key === "string" &&
      /^[0-9a-f]{64}$/.test(m.key) &&
      typeof m.createdAt === "number",
  );
  const now = readMyPuzzles();
  const have = new Set(now.map((m) => m.id));
  const added = valid.filter((m) => !have.has(m.id));
  try {
    localStorage.setItem(MY_PUZZLES_KEY, JSON.stringify([...now, ...added]));
    localStorage.setItem(PLAYER_KEY, b.playerKey);
  } catch {
    return null;
  }
  return { added: added.length };
}
