// 受付係の「住所の札を読む」部分を手元で動かして確かめる。
// functions/_shared の TypeScript を typescript で素の JavaScript に直し、一時置き場から読み込む。
// 使い方: どこからでも `node scripts/verify/hai-to-diamond/test-card-tag.mjs`
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT_ROOT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'hai-to-diamond-verify');
const TMP = path.join(OUT_ROOT, 'card-test');
mkdirSync(TMP, { recursive: true });
for (const n of ['ogp', 'haiToDiamondCard']) {
  let js = ts.transpileModule(readFileSync(path.join(ROOT, 'functions/_shared', `${n}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace("from './ogp'", "from './ogp.mjs'");
  writeFileSync(path.join(TMP, `${n}.mjs`), js);
}
const { parseCardTag, cardUrls, CARD_MEMBER_IDS, CARD_COMPS } = await import(pathToFileURL(path.join(TMP, 'haiToDiamondCard.mjs')).href);

let ok = 0, ng = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok++; else { ng++; console.log('✗', name, '\n   出た', g, '\n   欲しい', w); }
};
const O = 'https://hop-up-tools.pages.dev';
const BASE = { canonicalUrl: O + '/hai-to-diamond', image: O + '/ogp/hai-to-diamond.png' };

// 正しい札
eq('正しい札', parseCardTag(['nishida', '2']), { memberId: 'nishida', comp: '2' });
eq('正しい札の絵', cardUrls(O, parseCardTag(['kiyono', '3'])), { canonicalUrl: O + '/hai-to-diamond/kiyono/3', image: O + '/ogp/hai-to-diamond/kiyono-3.jpg' });
// 決まりに合わない札は全部、全員の絵
const bad = [
  undefined, null, 'nishida', [], ['nishida'], ['nishida', '2', 'x'], ['nishida', '0'], ['nishida', '4'], ['nishida', '02'],
  ['nishida', ' 2'], ['nishida', '2 '], ['nishida', '0x2'], ['nishida', '2e0'], ['Nishida', '2'], ['unknown', '1'],
  ['../index', '1'], ['..', '..'], ['nishida-1.jpg', '1'], ['', ''], ['nishida', ''], [1, 2], ['nishida', 2],
  ['constructor', '1'], ['__proto__', '1'], ['toString', '1'],
];
for (const b of bad) {
  eq('弾く ' + JSON.stringify(b), parseCardTag(b), null);
  eq('弾いた時の絵 ' + JSON.stringify(b), cardUrls(O, parseCardTag(b)), BASE);
}
// 一覧のすべての組で、絵のファイルが本当に置いてある
for (const id of CARD_MEMBER_IDS) for (const c of CARD_COMPS) {
  const { image } = cardUrls(O, parseCardTag([id, c]));
  const file = path.join(ROOT, 'public', image.slice(O.length));
  eq('絵がある ' + file, existsSync(file), true);
}
// 受付係の一覧が、ページの側の並びと同じ14個か
const members = readFileSync(path.join(ROOT, 'src/pages/hai-to-diamond/members.ts'), 'utf8');
const order = [...members.split('DIAMOND_COLOR_ORDER')[1].split('] as const')[0].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
eq('ページの並びと同じ14個', [...CARD_MEMBER_IDS], order);
eq('構図は3つ', [...CARD_COMPS], ['1', '2', '3']);
// ---- ページの側（src/pages/hai-to-diamond/members.ts）----
const tsx = (src) => ts.transpileModule(readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const dataJs = tsx(path.join(ROOT, 'src/pages/hi-tension/data.ts'));
if (/^import /m.test(dataJs)) console.log('注意: hi-tension/data.ts が他のファイルを読み込んでいる。確かめの台本の手直しが要るかもしれない');
writeFileSync(path.join(TMP, 'data.mjs'), dataJs);
writeFileSync(path.join(TMP, 'members.mjs'), tsx(path.join(ROOT, 'src/pages/hai-to-diamond/members.ts')).replace('"../hi-tension/data"', '"./data.mjs"'));
const M = await import(pathToFileURL(path.join(TMP, 'members.mjs')).href);

eq('ページの側の構図の数', M.SHARE_CARD_COMPS, CARD_COMPS.length);
// 最初の色: 最後に使った色 → シェアのリンクの色 → いつもの最初の色
eq('初めての人・札あり → 看板の色', M.pickInitialMemberId(null, '/hai-to-diamond/kiyono/2'), 'kiyono');
eq('初めての人・札あり・末尾の/', M.pickInitialMemberId(null, '/hai-to-diamond/kiyono/2/'), 'kiyono');
eq('遊んだ人・札あり → 自分の色のまま', M.pickInitialMemberId('maeda', '/hai-to-diamond/kiyono/2'), 'maeda');
eq('初めての人・札なし → いつもの最初の色', M.pickInitialMemberId(null, '/hai-to-diamond'), M.DIAMOND_DEFAULT_MEMBER_ID);
eq('初めての人・知らない色の札 → いつもの最初の色', M.pickInitialMemberId(null, '/hai-to-diamond/unknown/9'), M.DIAMOND_DEFAULT_MEMBER_ID);
eq('控えが今の並びに無い色・札あり → 看板の色', M.pickInitialMemberId('ichioka', '/hai-to-diamond/takase/1'), 'takase');
eq('控えが今の並びに無い色・札なし', M.pickInitialMemberId('ichioka', '/hai-to-diamond'), M.DIAMOND_DEFAULT_MEMBER_ID);
eq('段が多い住所は札と見なさない', M.pickInitialMemberId(null, '/hai-to-diamond/kiyono/2/x'), M.DIAMOND_DEFAULT_MEMBER_ID);
eq('別のページの住所', M.pickInitialMemberId(null, '/hi-tension/kiyono/2'), M.DIAMOND_DEFAULT_MEMBER_ID);
// シェアの札: くじの端から端まで
eq('くじ 0 → 1', M.shareLinkTag('nishida', () => 0), '/nishida/1');
eq('くじ 0.34 → 2', M.shareLinkTag('nishida', () => 0.34), '/nishida/2');
eq('くじ 0.67 → 3', M.shareLinkTag('nishida', () => 0.67), '/nishida/3');
eq('くじ 0.9999 → 3', M.shareLinkTag('nishida', () => 0.9999999), '/nishida/3');
eq('くじが 1 を返しても 3 で止まる', M.shareLinkTag('nishida', () => 1), '/nishida/3');
eq('並びに無い色 → 札なし', M.shareLinkTag('unknown', () => 0.5), '');
// ページが作る札は、受付係が必ず受け取れる（14色×くじ3通り）
for (const id of M.DIAMOND_COLOR_ORDER) for (const r of [0, 0.5, 0.99]) {
  const tag = M.shareLinkTag(id, () => r);
  const parts = tag.split('/').filter(Boolean);
  eq('ページの札を受付係が読める ' + tag, parseCardTag(parts)?.memberId, id);
  eq('ページの札でページの最初の色も決まる ' + tag, M.pickInitialMemberId(null, '/hai-to-diamond' + tag), id);
}
// 色の控えはハイ！テンションと分けてある（灰toダイヤモンドのどのファイルも、共用の控えの読み書きを呼ばない）
const htdDir = path.join(ROOT, 'src/pages/hai-to-diamond');
const touching = readdirSync(htdDir, { recursive: true }).filter((f) => /\.tsx?$/.test(f))
  .filter((f) => /LastSelectedMemberId|hi_tension:last_selected_member_id/.test(readFileSync(path.join(htdDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
eq('共用の控えに触るファイル', touching, []);
eq('専用の控えの鍵', /const KEY_LAST_MEMBER = "([^"]+)"/.exec(readFileSync(path.join(htdDir, 'members.ts'), 'utf8'))?.[1], 'hai_to_diamond:last_selected_member_id');
// 控えの読み書き（ブラウザの控えの代わりを置いて動かす）
const store = new Map([['hi_tension:last_selected_member_id', 'maeda']]);
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)) };
eq('共用の控えに色があっても、専用の控えは空', M.getLastDiamondMemberId(), null);
eq('だから看板の色で始まる', M.pickInitialMemberId(M.getLastDiamondMemberId(), '/hai-to-diamond/kiyono/2'), 'kiyono');
M.setLastDiamondMemberId('hirai');
eq('専用の控えに書ける', M.getLastDiamondMemberId(), 'hirai');
eq('共用の控えは書き換わらない', store.get('hi_tension:last_selected_member_id'), 'maeda');
eq('次からは自分の色', M.pickInitialMemberId(M.getLastDiamondMemberId(), '/hai-to-diamond/kiyono/2'), 'hirai');
globalThis.localStorage = { getItem() { throw new Error('使えない'); }, setItem() { throw new Error('使えない'); } };
eq('控えが使えない端末でも落ちない（読み）', M.getLastDiamondMemberId(), null);
eq('控えが使えない端末でも落ちない（書き）', M.setLastDiamondMemberId('hirai'), undefined);
// 本物のくじを1000回引いて、1〜3しか出ないことと、3つとも出ること
const seen = new Set();
for (let i = 0; i < 1000; i++) seen.add(M.shareLinkTag('eguchi'));
eq('本物のくじで出る札', [...seen].sort(), ['/eguchi/1', '/eguchi/2', '/eguchi/3']);

console.log(`確かめ ${ok + ng}件 ／ 合 ${ok} ／ 否 ${ng}`);
process.exit(ng ? 1 : 0);
