// 通報の「別々の3人」を数える見分けの値（functions/_shared/reporterKey.ts）を、本物のファイルのまま動かして確かめる。
// 紙: セキュリティ監査「通報の『別々の3人』は IPv6 を /64 の帯で丸めてから数える」
// ts は Node の node:module の stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// 使い方: node scripts/verify/crossword/check-reporter-key.mjs（引数なし。通信しない）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { ROOT, outDir } from './_lib.mjs';

const src = readFileSync(path.join(ROOT, 'functions', '_shared', 'reporterKey.ts'), 'utf8');
const js = stripTypeScriptTypes(src);
const file = path.join(outDir('check-reporter-key'), 'reporterKey.mjs');
writeFileSync(file, js);
const { reporterKey } = await import(pathToFileURL(file).href + `?t=${Date.now()}`);

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const k = (ip) => reporterKey(ip);

check(k('2001:db8::1') === k('2001:db8:0:0:1:2:3:4'), `2001:db8::1 と 2001:db8:0:0:1:2:3:4 は同じ帯: ${k('2001:db8::1')} / ${k('2001:db8:0:0:1:2:3:4')}`);
check(k('2001:db8:0:1::') !== k('2001:db8::1'), `2001:db8:0:1:: は別の帯: ${k('2001:db8:0:1::')}`);
check(k('203.0.113.5') === '203.0.113.5', `IPv4 はそのまま: ${k('203.0.113.5')}`);
check(k('::ffff:203.0.113.5') === '203.0.113.5', `::ffff:203.0.113.5 は IPv4 に戻る: ${k('::ffff:203.0.113.5')}`);
check(k('2001:db8::1').endsWith('::/64'), `IPv6 は /64 の形になる: ${k('2001:db8::1')}`);

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
