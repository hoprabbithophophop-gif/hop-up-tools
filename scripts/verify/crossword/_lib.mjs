// クロスワードの確かめの台本で共通に使う物。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { chromium, webkit, firefox } from 'playwright';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// 2026-10-05 に足した「初めて」の案内（解く画面の脈打ちと1行・作る画面の札・作る画面の案内）を、台本では出さない。
// どの台本も playwright の chromium／webkit から開くので、ここで開く前の印を立てる（ブラウザの記録を作るたびに、ページの読み込みより先に入れる）。
// 案内そのものを確かめる check-tutorial だけは leaveFirstVisitMarks() を呼んで印を立てずに流す。
// もとからある遊び方の窓の印（crossword_seen_help）は立てない。遊び方の窓を確かめる台本があり、解く画面の台本はそれぞれ必要な時に自分で立てている。
// 練習問題（/crossword/tutorial）は「?」から開いた時だけで、開けば必ず案内が出る（印 crossword_seen_tutorial は記録だけ）
export const SEEN_MARKS = {
  crossword_seen_create_guide: '1', // 「?」から開く作る画面の案内（今は自動では出ない）
  crossword_seen_first_cell: '1', // 解く画面の最初のマスの脈打ちと1行
  crossword_seen_tip_cross: '1', // 作る画面の札（最初の語の後）
  crossword_seen_tip_move: '1', // 作る画面の札（交差して組まれた後）
  crossword_seen_tip_saved: '1', // 共有の窓の札
};
let markSeen = true;
export const leaveFirstVisitMarks = () => {
  markSeen = false;
};
const seenScript = (marks) => {
  try {
    for (const [k, v] of Object.entries(marks)) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
  } catch { /* 記録を使えないページ（about:blank など）では何もしない */ }
};
const withMarks = async (ctx) => {
  if (markSeen) await ctx.addInitScript(seenScript, SEEN_MARKS);
  return ctx;
};
for (const type of [chromium, webkit, firefox]) {
  const launch = type.launch.bind(type);
  type.launch = async (...args) => {
    const b = await launch(...args);
    const newContext = b.newContext.bind(b);
    b.newContext = async (...a) => withMarks(await newContext(...a));
    const newPage = b.newPage.bind(b);
    b.newPage = async (...a) => {
      const page = await newPage(...a);
      if (markSeen) await page.context().addInitScript(seenScript, SEEN_MARKS);
      return page;
    };
    return b;
  };
}
export const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

// 既定の行き先と問題の番号（引数も環境変数も無いときに使う）。引数があれば引数が勝つ
export const TARGETS = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'targets.json'), 'utf8'));
// 位置で渡す引数。無ければ fallback
export const arg = (i, fallback) => (process.argv[i] !== undefined && process.argv[i] !== '' ? process.argv[i] : fallback);
export const BASE_DEFAULT = TARGETS.base;
export const ID_DEFAULT = TARGETS.puzzleId;

// 一時置き場の根元。作業フォルダには書かない
export const TMP_ROOT = path.join(os.tmpdir(), 'hop-up-tools-verify', 'crossword');
// 写真の置き場。環境変数 OUT があればそれ、無ければ 一時置き場/hop-up-tools-verify/crossword/<台本名>/
export function outDir(name, explicit) {
  const dir = explicit || process.env.OUT || path.join(TMP_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// 遊ばれた回数を数える呼び出し（/api/crossword-play の touch）を途中で受け止める。本物の回数は増やさない。
// ほかの呼び出しは次の受け止め役か本物の受付係へ回す。onCount は受け止めるたびに呼ぶ
export async function interceptCount(ctx, onCount = () => {}) {
  await ctx.route('**/api/crossword-play', (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.action !== 'touch') return r.fallback();
    onCount();
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"counted":true}' });
  });
}

// 受付係は「字の数×1秒」より速く解けた回をランキングに載せない（2026-10-04）。
// 名前を入れる窓まで確かめる台本は、解き終える前にこれだけ待つ
export const humanWaitMs = (cells) => (cells + 3) * 1000;

// 文字盤でそのまま押せる字（゛゜小を使わない字）
const PLAIN = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
export const isPlain = (ch) => PLAIN.includes(ch);
// 正しい字と違う、そのまま押せる字
export const wrongCharFor = (ch) => (ch === 'ア' ? 'イ' : 'ア');

// 問題の盤の形と答え。答えはブラウザに渡らない作りなので、
// 1) 画面を開いて Supabase から届く問題の本文（マスの位置）を受け取り、
// 2) 受付係に回を1つ始めてもらい、全部のマスを「1文字見る」で聞く。
// 結果は一時置き場に控え、次からはそれを使う（回を始める上限 1時間300回 を使い切った後でも台本が流れるように）。
// 聞くのに使った回は本番の crossword_plays に1行残る（30日で片付く）
export async function puzzleLayout(base, id) {
  const cacheDir = path.join(TMP_ROOT, '_cache');
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `layout-${new URL(base).host}-${id}.json`);
  if (existsSync(cacheFile)) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (c && c.cells && Object.keys(c.cells).length) return c;
    } catch { /* 読めなければ取り直す */ }
  }
  const browser = await chromium.launch();
  let record = null;
  try {
    const page = await browser.newPage();
    const got = page.waitForResponse((r) => r.url().includes('/rest/v1/crossword_puzzles') && r.url().includes(`id=eq.${id}`) && r.url().includes('body'), { timeout: 30000 });
    await page.goto(`${base}/crossword/${id}`);
    const rows = await (await got).json();
    record = rows[0] ?? null;
  } finally {
    await browser.close();
  }
  if (!record?.body?.clues) throw new Error(`問題 ${id} の本文が読めなかった`);
  const clues = record.body.clues;
  const minX = Math.min(...clues.map((c) => c.startX));
  const minY = Math.min(...clues.map((c) => c.startY));
  const keys = new Set();
  for (const c of clues) {
    for (let k = 0; k < c.length; k++) {
      keys.add(`${c.startX - minX + (c.direction === 'horizontal' ? k : 0)},${c.startY - minY + (c.direction === 'vertical' ? k : 0)}`);
    }
  }
  const post = async (payload) => {
    const res = await fetch(`${base}/api/crossword-play`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(`受付係 ${payload.action}: ${res.status} ${JSON.stringify(j)}`);
    return j;
  };
  const { token } = await post({ action: 'start', puzzleId: id });
  const cells = {};
  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    cells[key] = (await post({ action: 'reveal', token, x, y })).char;
  }
  // 台本が受け取る「答えの配置 JSON」の形（画面の座標・左上が 0,0）
  const cluesJson = clues.map((c) => {
    const x = c.startX - minX;
    const y = c.startY - minY;
    const a = Array.from({ length: c.length }, (_, k) => cells[`${x + (c.direction === 'horizontal' ? k : 0)},${y + (c.direction === 'vertical' ? k : 0)}`]);
    return { a, x, y, d: c.direction };
  });
  const layout = { id, title: record.title, clueTexts: clues.map((c) => c.clue), cells, cluesJson, layoutToken: token, fetchedAt: new Date().toISOString() };
  writeFileSync(cacheFile, JSON.stringify(layout, null, 1));
  return layout;
}

// 盤のマス（#cell-x-y）。state を渡すと、読み上げ名の最後（「・空」「・ダ」など）がその字のマスだけを指す。
// マスの読み上げ名は「1ヨコ・2文字の1文字目・空」の形（2026-10-06 アクセシビリティの直しで「1行1列：空」から変えた）
export const cellAt = (page, x, y, state) => page.locator(state === undefined ? `#cell-${x}-${y}` : `#cell-${x}-${y}[aria-label$="・${state}"]`);
// 読み上げ名の最後の字（空のマスは「空」）
export const cellState = (label) => String(label ?? '').split('・').at(-1);
// "x,y" → [x, y]
export const xy = (k) => k.split(',').map(Number);

// 答えの配置 JSON から マス→字 を作る
export function cellsOf(cluesJson) {
  const full = {};
  for (const c of cluesJson) c.a.forEach((ch, i) => {
    full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
  });
  return full;
}

// 台本の引数の既定（答えの配置・残すマス・字）。引数で渡された物はそのまま使う。
// 残すマスは、文字盤でそのまま押せる字のマスから選ぶ
export async function puzzleArgs(base, id, given = {}) {
  let cluesJson = given.cluesJson ? JSON.parse(given.cluesJson) : null;
  let layout = null;
  if (!cluesJson) {
    layout = await puzzleLayout(base, id);
    cluesJson = layout.cluesJson;
  }
  const full = cellsOf(cluesJson);
  const plain = Object.keys(full).filter((k) => isPlain(full[k]));
  const cell1 = given.cell1 || plain[0];
  const cell2 = given.cell2 || plain.find((k) => k !== cell1);
  const last = given.last || cell1;
  return {
    cluesJson,
    clues: JSON.stringify(cluesJson),
    full,
    last,
    lastChar: given.lastChar || full[last],
    wrongChar: given.wrongChar || wrongCharFor(full[last]), // 残すマス（last）の間違いの字
    wrongChar1: given.wrongChar || wrongCharFor(full[cell1]), // 残すマス1（cell1）の間違いの字
    cell1,
    cell2,
    layout,
  };
}
