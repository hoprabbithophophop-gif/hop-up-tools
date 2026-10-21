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
  crossword_seen_trace: '1', // 作る画面の1の段の「字をなぞる」動き（2026-10-20。初めての端末で一度だけ。check-create-flow が確かめる）
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

// 行き先（プレビュー・本番）へ書き込みが出ないようにする見張り（2026-10-21）。ブラウザの記録を作った直後、ほかの受け止め役より先に呼ぶ。
// 後から足した受け止め役が先に効くので、ここまで届いた物は「どの受け止め役も返さなかった通信」。
// 行き先の受付係（/api/）への通信と、棚（/rest/v1/）への GET・HEAD・OPTIONS 以外（読むだけの rpc/crossword_is_hidden は通す）は外へ出さずに断り、writes に控える
export const READ_ONLY_RPC = ['/rest/v1/rpc/crossword_is_hidden'];
// 台本が途中で止まっても、断った件数は終わりに必ず1行出す
const guarded = new Set();
let guardReport = false;
export async function guardWrites(ctx, writes, base = BASE_DEFAULT) {
  const site = new URL(base).origin;
  guarded.add(writes);
  if (!guardReport) {
    guardReport = true;
    process.on('exit', () => {
      const all = [...guarded].flat();
      console.log(`見張り役: 行き先への書き込みを断った通信 ${all.length}件${all.length ? ' ' + all.join(' , ') : ''}`);
    });
  }
  await ctx.route('**/*', (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const isApi = u.origin === site && u.pathname.startsWith('/api/');
    const isShelfWrite = u.pathname.startsWith('/rest/v1/') && m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !READ_ONLY_RPC.includes(u.pathname);
    if (isApi || isShelfWrite) {
      writes.push(`${m} ${u.origin}${u.pathname}`);
      return r.abort('blockedbyclient');
    }
    return r.fallback();
  });
}

// 受付係は「字の数×1秒」より速く解けた回をランキングに載せない（2026-10-04）。
// 名前を入れる窓まで確かめる台本は、解き終える前にこれだけ待つ
export const humanWaitMs = (cells) => (cells + 3) * 1000;

// 受付係が回を始めて、その番号が端末の途中経過に入るまで待つ（最大 timeout ms）。
// 並べて流すと受付係の返事が遅れ、番号が入る前に「人の速さの待ち」を始めると、待ちが回の前に終わって
// 最初の丸付けで新しい回が始まり「速すぎる回」扱いになる（名前の窓が出ない）。人の速さの待ちの前に必ず挟む
export const waitForPlayToken = (page, id, timeout = 20000) =>
  page.waitForFunction((pid) => {
    try { return !!JSON.parse(localStorage.getItem(`crossword_progress_${pid}`) || '{}').play; } catch { return false; }
  }, id, { timeout }).then(() => true, () => false);

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

// 画面のつまずきの見張り（2026-10-21）。JS の例外（pageerror）に加えて、
// React がエラーの受け止め役（src/components/ErrorBoundary.tsx）に渡した描画の誤りと、エラー時の画面（「予期しないエラーが発生しました」）が出たことを数える。
// React 19 は受け止め役が受け止めた例外を pageerror にしない（console.error に出すだけ）ので、pageerror だけを見ていると素通りする。
// 数えるのは下の REACT_STUMBLE に合う console の error だけ。favicon の 404・cloudflareinsights の CORS など関係ない誤りは数えない。
// 使い方: ページを開く前（goto の前）に watchStumbles(page, 控える配列, '作る画面') を呼ぶ。控える配列の数が 0 なら OK
export const REACT_STUMBLE = [
  /Rendered (fewer|more) hooks than expected/,
  /change in the order of Hooks/,
  /Minified React error/,
  /The above error occurred/,
  /An error occurred in the <[^>]+> component/,
  /Maximum update depth exceeded/,
  /\[ErrorBoundary\]/,
  /\[台本の見張り\]/,
];
export const ERROR_SCREEN_TEXT = '予期しないエラーが発生しました';
const stumbleWatched = new WeakSet();
const errorScreenScript = (text) => {
  try {
    let told = false;
    const look = () => {
      if (told || !document.body) return;
      if (document.body.innerText.includes(text)) {
        told = true;
        console.error(`[台本の見張り] エラー時の画面が出た（${location.pathname}${location.search}）`);
      }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  } catch { /* 見張れないページ（about:blank など）では何もしない */ }
};
export async function watchStumbles(page, sink, label = '') {
  const tag = label ? `${label}: ` : '';
  const ctx = page.context();
  if (!stumbleWatched.has(ctx)) {
    stumbleWatched.add(ctx);
    await ctx.addInitScript(errorScreenScript, ERROR_SCREEN_TEXT);
  }
  // 例外は、そのときの住所と投げた場所の1行目も控える（どの画面・どの読み込み元かを切り分けるため）
  page.on('pageerror', (e) => {
    const at = String(e.stack || '').split(/\r?\n/).find((l) => /^\s*at /.test(l))?.trim() ?? '';
    sink.push(`${tag}${String(e)}（${page.url()}${at ? ' ' + at.slice(0, 200) : ''}）`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (REACT_STUMBLE.some((re) => re.test(t))) sink.push(`${tag}${t.replace(/\s+/g, ' ').slice(0, 300)}`);
  });
}

// 手元の開発サーバー（vite）を台本ごとに別のまとめ置き場で立てるための設定ファイル（2026-10-22）。
// vite は画面が初めて読み込んだ部品をその場でまとめ直し、まとめ直すとページを読み込み直す。まとめ置き場（node_modules/.vite）は
// 作業場所どうしで共有なので、別の台本の vite がまとめ直すと巻き添えで読み込み直され、確かめの途中で書いた中身が消えて落ちる。
// 本物の vite.config.ts をそのまま読み込み、まとめ置き場（cacheDir）だけを一時置き場の口ごとの場所に替える。
// 書き換えの見張り（HMR）も止める（台本を並べて流すと PC が重くなり、見張りのつなぎが切れたと見なしてページを読み込み直すため）。使い方:
//   spawn(node, [vite.js, '--config', isolatedViteConfig(PORT), '--port', String(PORT), '--strictPort'], { cwd: ROOT, ... })
export function isolatedViteConfig(port) {
  const dir = path.join(TMP_ROOT, '_vite');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `vite.config.${port}.mjs`);
  const slash = (p) => p.split(path.sep).join('/');
  const base = slash(path.join(ROOT, 'vite.config.ts'));
  const cache = slash(path.join(dir, `cache-${port}`));
  writeFileSync(file, `import base from ${JSON.stringify(base)};\nexport default { ...base, root: ${JSON.stringify(slash(ROOT))}, cacheDir: ${JSON.stringify(cache)}, server: { ...(base.server || {}), hmr: false } };\n`);
  return file;
}
