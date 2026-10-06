// 公式サイトのメンバー個人ページに「どんな項目が」「何人ぶん」載っているかを数える棚卸し。
// 値そのものは一切出力しない（出すのは項目名・人数・値の長さの目安だけ）。
// helloproject.com の決まり（AI に本文を読ませない）に合わせ、読み取りは正規表現だけ。
// 使い方: node scripts/crossword-profile/inventory.mjs
import { setTimeout as sleep } from 'node:timers/promises';

const SITE = 'https://www.helloproject.com';
const GROUP_PAGES = [
  '/morningmusume/',
  '/angerme/',
  '/juicejuice/',
  '/tsubakifactory/',
  '/beyooooonds/',
  '/ochanorma/',
  '/rosychronicle/',
  '/helloprokenshusei/',
  '/helloprokenshuseihokkaido/',
];

// gas/youtube-scraper.js の parseMembers と同じ形
const MEMBER_RE = /<a\s+href="([^"]+)"\s+class="MemberPanel__link[\s\S]{0,1500}?MemberPanel__nameJa[^>]*>([^<]+)</gi;
const DT_DD_RE = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;

const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function load(path) {
  const r = await fetch(SITE + path, { headers: { 'user-agent': 'Mozilla/5.0 (inventory; hop-up-tools)' } });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return await r.text();
}

const paths = [];
for (const g of GROUP_PAGES) {
  const html = await load(g);
  let m;
  const seen = new Set();
  while ((m = MEMBER_RE.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); paths.push(m[1]); }
  }
  console.log(`${g}: ${seen.size}人`);
  await sleep(700);
}
console.log(`合計 ${paths.length}人`);

// 項目名 → { n: 人数, lens: 値の文字数, sentence: 「。」等を含む件数, multi: 3つ以上の列挙の件数 }
const fields = new Map();
let ok = 0, ng = 0;
for (const p of paths) {
  let html;
  try { html = await load(p); ok++; }
  catch { ng++; await sleep(700); continue; }
  let m;
  const seenHere = new Set();
  while ((m = DT_DD_RE.exec(html)) !== null) {
    const label = plain(m[1]);
    const value = plain(m[2]);
    if (!label || seenHere.has(label)) continue;
    seenHere.add(label);
    const f = fields.get(label) ?? { n: 0, lens: [], sentence: 0, multi: 0 };
    f.n++;
    f.lens.push(value.length);
    if (/[。！？]/.test(value)) f.sentence++;
    if (value.split(/[、,/／・]/).length >= 3) f.multi++;
    fields.set(label, f);
  }
  await sleep(700);
}
console.log(`個人ページ 取れた ${ok} / 取れなかった ${ng}`);
console.log('');
console.log('項目名\t人数\t文字数(中央値)\t文の形\t3つ以上の列挙');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
for (const [label, f] of [...fields].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${label}\t${f.n}\t${median(f.lens)}\t${f.sentence}\t${f.multi}`);
}
