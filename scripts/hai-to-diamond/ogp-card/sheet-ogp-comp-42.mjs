// 【使い捨て】焼いた42枚(14色×3構図)を、幅160pxに縮めて並べた一覧を作る。
// sheet-ogp-comp.tmp.mjs の写し。違いは出力先(OUT)を今回の42枚ぶんの置き場にしただけ。
// 「小さくしても3つの構図が見分けられるか」を目で確かめるための紙。
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
// 既定は道具フォルダの中の out/ogp-comp-42。環境変数 OGP_COMP_OUT があればそちらを読む。
const OUT = process.env.OGP_COMP_OUT || DIR + '/out/ogp-comp-42';
const shots = JSON.parse(readFileSync(OUT + '/shots.json', 'utf8'));
const WIDTH = Number(process.argv[2] ?? 160);

const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

const ids = [...new Set(shots.map((s) => s.id))];
const h = Math.round((630 / 1200) * WIDTH);
let rows = '';
for (const id of ids) {
  rows += '<tr><th>' + id + '</th>';
  for (const c of [1, 2, 3]) {
    const s = shots.find((x) => x.id === id && x.comp === c);
    rows += '<td>' + (s
      ? `<img src="data:image/png;base64,${readFileSync(OUT + '/' + s.file).toString('base64')}"><div>C${c}</div>`
      : '—') + '</td>';
  }
  rows += '</tr>';
}
const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#101318;color:#e6e9ee;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;padding:14px}
 table{border-collapse:separate;border-spacing:10px}
 th{font-weight:600;color:#aab3bf;text-align:right;padding-right:4px;white-space:nowrap}
 img{display:block;width:${WIDTH}px;height:${h}px}
 td div{color:#7d8794;text-align:center;margin-top:2px}
 caption{text-align:left;color:#aab3bf;padding-bottom:8px}
</style><table><caption>幅${WIDTH}pxに縮めた一覧（左から構図1・構図2・構図3）</caption>${rows}</table>`;
writeFileSync(OUT + `/sheet-${WIDTH}.html`, html);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: WIDTH * 3 + 200, height: (h + 30) * ids.length + 80 }, deviceScaleFactor: 1 });
await p.setContent(html);
await p.waitForTimeout(400);
await p.screenshot({ path: OUT + `/sheet-${WIDTH}.png`, fullPage: true });
console.log('一覧', OUT + `/sheet-${WIDTH}.png`);
await b.close();
