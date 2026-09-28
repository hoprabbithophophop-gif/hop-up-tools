// 見返し中に「選んでいる色の星だけが瞬く」を、曲を通さずに単体で確かめる。
// 1) 星を瞬かせる部品（canvas/sky.ts の addStar と sparkSky）を素の JavaScript に直して動かす
// 2) 描き手（DiamondCanvas.tsx）が sparkSky へ渡している値が、色の値の札になっていることをコードで確かめる
// 使い方: どこからでも `node scripts/verify/hai-to-diamond/test-sky-spark.mjs`
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT_ROOT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'hai-to-diamond-verify');
const TMP = path.join(OUT_ROOT, 'sky-test');
mkdirSync(TMP, { recursive: true });
let js = ts.transpileModule(readFileSync(path.join(ROOT, 'src/pages/hai-to-diamond/canvas/sky.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
// pile からは定数 MAX_DPR と型しか読んでいないので、定数だけ置き換える
js = js.replace(/import \{[^}]*\} from "\.\/pile";/, 'const MAX_DPR = 2;');
writeFileSync(path.join(TMP, 'sky.mjs'), js);
const sky = await import(pathToFileURL(path.join(TMP, 'sky.mjs')).href);

let ok = 0, ng = 0;
const check = (name, cond, detail) => { if (cond) ok++; else { ng++; console.log('✗', name, detail ?? ''); } };

const PINK = [218, 24, 132], RED = [231, 0, 51], YELLOW = [253, 218, 36];
const stars = [], byColor = new Map();
const W = 390, H = 844, v = { x: 14, y: 122, w: 347, h: 200 };
// 動画の外に、色ごとに40個ずつ星を置く
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const rgb of [PINK, RED, YELLOW]) for (let i = 0; i < 40; i++) sky.addStar(stars, byColor, rnd() * W, 400 + rnd() * 400, rgb);
check('星を120個置けた', stars.length === 120);
check('棚の札は色の値', [...byColor.keys()].join('|') === '218,24,132|231,0,51|253,218,36', [...byColor.keys()].join('|'));

const run = (onlyOwn, key) => {
  const flashes = [];
  for (let i = 0; i < 4000; i++) sky.sparkSky(stars, byColor, flashes, i, 1, W, H, v, onlyOwn, key);   // dt=1 で毎回必ず引かせる
  const by = {}; for (const f of flashes) by[f.rgb.join(',')] = (by[f.rgb.join(',')] || 0) + 1;
  return { n: flashes.length, by };
};

// 直す前の渡し方（メンバーID）＝不具合の再現: 1つも瞬かない
const bug = run(true, 'nishida');
check('メンバーIDで引くと1つも瞬かない（直す前の不具合の再現）', bug.n === 0, JSON.stringify(bug));
// 直した後の渡し方（色の値の札）: 選んだ色の星だけが瞬く
const fixed = run(true, PINK.join(','));
check('色の値で引くと瞬く', fixed.n > 1000, JSON.stringify(fixed));
check('瞬くのは選んだ色の星だけ', Object.keys(fixed.by).join('|') === '218,24,132', JSON.stringify(fixed.by));
// 見返し中でない時は、今までどおり全部の色が瞬く
const all = run(false, PINK.join(','));
check('見返し中でなければ3色とも瞬く', Object.keys(all.by).length === 3, JSON.stringify(all.by));
// その色の星が1つも無い時は瞬かず、落ちもしない
const none = run(true, '1,2,3');
check('その色の星が無ければ瞬かない', none.n === 0);
check('札が null でも落ちない', run(true, null).n === 0);

// 描き手が sparkSky へ渡している値
const canvasSrc = readFileSync(path.join(ROOT, 'src/pages/hai-to-diamond/DiamondCanvas.tsx'), 'utf8');
const call = /sparkSky\([\s\S]*?\);/.exec(canvasSrc)?.[0] ?? '';
check('描き手は sparkSky へ色の値の札を渡している', /ownRgbKeyRef\.current\)/.test(call) && !/ownKeyRef\.current\)/.test(call), call.replace(/\s+/g, ' '));
check('色の値の札は setOwnColor で毎回入れ直している', /ownRgbKeyRef\.current = rgbKey;/.test(canvasSrc));
check('メンバーIDの札は一番輝いた瞬間のために残っている', /const k = key \?\? ownKeyRef\.current;/.test(canvasSrc));

console.log(`確かめ ${ok + ng}件 ／ 合 ${ok} ／ 否 ${ng}`);
process.exit(ng ? 1 : 0);
