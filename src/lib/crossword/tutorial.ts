// 解く画面の練習問題（/crossword/tutorial）。本番の棚には入れず、コードの中に固定で持つ（Hop 決定 2026-10-05・案B）。
// 答えはこの中にある。答え合わせは受付係を通さずブラウザの中だけで行う（練習問題専用の道筋）。
// 問題とカギとヒントはすべて【仮】
//   x=0 x=1 x=2 x=3
// y=0 ネ  コ
// y=1     ア
// y=2     ラ  ム  ネ
import { buildGrid } from "./engine";
import type { PlacedItem, PuzzleData } from "./types";

const items: PlacedItem[] = [
  { id: "t1", uuid: "t1", answer: ["ネ", "コ"], question: "ニャーと鳴く動物", direction: "horizontal", startX: 0, startY: 0, length: 2 },
  { id: "t2", uuid: "t2", answer: ["コ", "ア", "ラ"], question: "ユーカリの葉を食べる動物", direction: "vertical", startX: 1, startY: 0, length: 3 },
  { id: "t3", uuid: "t3", answer: ["ラ", "ム", "ネ"], question: "ビー玉で栓をした炭酸の飲み物", direction: "horizontal", startX: 1, startY: 2, length: 3 },
];

export const TUTORIAL_TITLE = "練習問題"; // 【仮】

export function tutorialPuzzle(): PuzzleData {
  const p = buildGrid(items.map((i) => ({ ...i, answer: [...i.answer] })));
  p.id = "tutorial";
  p.title = TUTORIAL_TITLE;
  return p;
}

// 練習問題のヒント（動画でなく1行の文）。カギの uuid ごと【仮】
export const TUTORIAL_HINTS: Record<string, string> = {
  t1: "2文字目は「コ」。タテの答えの1文字目と同じです。",
  t2: "オーストラリアにいる、木の上で暮らす動物です。",
  t3: "夏祭りの屋台でよく売られています。",
};
