// 【使い捨て】調整ツールを、外から何も読み込まない1枚のHTMLに束ねる。
// 束ねる道具は作業フォルダの vite だけ。新しい部品は足していない。
//
// 出来上がり: out/gem-studio.bundle.html
//   途中の置き場は、ほかの台本の出来上がりを消さないよう、道具フォルダの中の out/ に分ける。
//   Artifact に貼れる形にするため、<html> <head> <body> の囲いは付けない。
//   <title> と <style> から始まり、中身と、中に書き込んだ script で終わる。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const TMP = DIR + '/out/build';
const OUT = DIR + '/out/gem-studio.bundle.html';

const req = createRequire(ROOT + '/package.json');
const { build } = await import(pathToFileURL(req.resolve('vite')).href);

mkdirSync(TMP, { recursive: true });

await build({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: TMP,
    emptyOutDir: true,
    target: 'es2020',
    minify: 'oxc',
    cssCodeSplit: false,
    lib: {
      entry: DIR + '/gemStudio.ts',
      formats: ['iife'],
      name: 'GemStudioTmp',
      fileName: () => 'gem-studio.tmp.js',
    },
  },
});

const js = readFileSync(TMP + '/gem-studio.tmp.js', 'utf8');
const shell = readFileSync(DIR + '/gem-studio.html', 'utf8');

const cut = (from, to) => {
  const a = shell.indexOf(from);
  const b = shell.indexOf(to);
  if (a < 0 || b < 0) throw new Error('目印が見つからない: ' + from + ' / ' + to);
  return shell.slice(a + from.length, b).trim();
};
const head = cut('<!--FRAGMENT-START-->', '<!--HEAD-END-->');
const body = cut('<!--BODY-START-->', '<!--FRAGMENT-END-->');

// 中に書き込む文の中で script の閉じ札に見える並びがあると、そこで切れてしまうので逃がす
const safe = js.split('</script').join('<\\/script');

const out = head + '\n' + body + '\n<script>\n' + safe + '\n</script>\n';
writeFileSync(OUT, out);

const kb = (n) => (n / 1024).toFixed(1) + 'KB';
console.log('中に書き込んだ script', kb(Buffer.byteLength(safe)));
console.log('出来上がり', OUT, kb(Buffer.byteLength(out)));
