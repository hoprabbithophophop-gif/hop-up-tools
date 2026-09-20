// 小分けで焼いた記録 shots.<tag>.json を、色の並びの順に1つの shots.json へまとめる
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
// 既定は道具フォルダの中の out/ogp-comp-42。環境変数 OGP_COMP_OUT があればそちらを読む
const OUT = process.env.OGP_COMP_OUT || DIR + '/out/ogp-comp-42';
const ORDER = ['nishida', 'eguchi', 'otsubo', 'sugiyama', 'maeda', 'okamura', 'kiyono', 'kojima', 'hirai', 'kobayashi', 'satoyoshi', 'shimakura', 'takase', 'yamazaki'];
// 同じ枚を焼き直した時は、後から焼いた記録で上書きする（ファイルの更新時刻の古い順に読む）
import { statSync } from 'node:fs';
const byFile = new Map();
const files = readdirSync(OUT).filter((f) => /^shots\..+\.json$/.test(f))
  .sort((a, b) => statSync(OUT + '/' + a).mtimeMs - statSync(OUT + '/' + b).mtimeMs);
for (const f of files) for (const r of JSON.parse(readFileSync(OUT + '/' + f, 'utf8'))) byFile.set(r.file, r);
const all = [...byFile.values()];
const keyOf = (r) => Object.keys(r).filter((k) => typeof r[k] === 'string' || typeof r[k] === 'number');
console.log('1件目の項目名', keyOf(all[0]).join(','));
const layoutOf = (r) => String(r.layout ?? r.comp ?? r.key ?? r.file ?? '');
const idOf = (r) => String(r.id ?? r.member ?? '');
all.sort((a, b) => layoutOf(a).localeCompare(layoutOf(b)) || ORDER.indexOf(idOf(a)) - ORDER.indexOf(idOf(b)));
writeFileSync(OUT + '/shots.json', JSON.stringify(all, null, 1));
console.log('まとめた枚数', all.length);
