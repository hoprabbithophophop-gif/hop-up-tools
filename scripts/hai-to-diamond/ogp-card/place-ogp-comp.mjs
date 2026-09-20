// 焼いた42枚（実寸のJPEG）を、本番の素材の置き場へ <id>-<構図の番号>.jpg の名前で写す
//
// 引数なしで回すと、何をどこへ写すかを並べるだけで、1枚も書かない。
// 実際に写す時は --write を付ける（本番の絵を上書きするので、合図なしでは書かない）。
// 読む場所の既定は道具フォルダの中の out/ogp-comp-42。環境変数 OGP_COMP_OUT があればそちらを読む
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const SRC = process.env.OGP_COMP_OUT || DIR + '/out/ogp-comp-42';
const DST = ROOT + '/public/ogp/hai-to-diamond';
const WRITE = process.argv.includes('--write');
const IDS = ['nishida', 'eguchi', 'otsubo', 'sugiyama', 'maeda', 'okamura', 'kiyono', 'kojima', 'hirai', 'kobayashi', 'satoyoshi', 'shimakura', 'takase', 'yamazaki'];
if (WRITE) mkdirSync(DST, { recursive: true });
let n = 0, bytes = 0;
for (const id of IDS) for (const c of [1, 2, 3]) {
  const from = `${SRC}/C${c}_${id}.full.jpg`;
  if (!existsSync(from)) throw new Error('無い: ' + from);
  const to = `${DST}/${id}-${c}.jpg`;
  if (WRITE) copyFileSync(from, to);
  else console.log('写す予定', `C${c}_${id}.full.jpg`, '→', `public/ogp/hai-to-diamond/${id}-${c}.jpg`);
  n++; bytes += statSync(WRITE ? to : from).size;
}
console.log(WRITE ? '置いた枚数' : '写す予定の枚数（--write が無いので書いていない）', n, '／ 合計', (bytes / 1024 / 1024).toFixed(2), 'MB');
