// 公式サイトの個人ページから、クロスワードの材料にする6項目だけを機械で読み取り、表にして保存する。
// 読み取りは正規表現だけ。出力先は scripts/crossword-profile/data/members.json（値は画面に出さない）。
// 画面に出すのは件数と「取れなかった項目の数」だけ。
// 使い方: node scripts/crossword-profile/collect.mjs
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';

const SITE = 'https://www.helloproject.com';
const GROUP_PAGES = [
  ['モーニング娘。', '/morningmusume/'],
  ['アンジュルム', '/angerme/'],
  ['Juice=Juice', '/juicejuice/'],
  ['つばきファクトリー', '/tsubakifactory/'],
  ['BEYOOOOONDS', '/beyooooonds/'],
  ['OCHA NORMA', '/ochanorma/'],
  ['ロージークロニクル', '/rosychronicle/'],
  ['ハロプロ研修生', '/helloprokenshusei/'],
  ['ハロプロ研修生', '/helloprokenshuseihokkaido/'],
];
const FIELDS = {
  birthday: '生年月日',
  blood: '血液型',
  origin: '出身地',
  joined: 'ハロー！プロジェクト加入',
  color: 'メンバーカラー',
  sport: '好きなスポーツ',
};

const MEMBER_RE = /<a\s+href="([^"]+)"\s+class="MemberPanel__link[\s\S]{0,1500}?MemberPanel__nameJa[^>]*>([^<]+)</gi;
const NAME_EN_RE = /MemberPanel__nameEn[^>]*>([^<]+)</i;
const DT_DD_RE = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
const COLOR_HEX_RE = /MemberHeader__color[^>]*background-color:\s*(#[0-9a-fA-F]{6})/i;

const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function load(path) {
  const r = await fetch(SITE + path, { headers: { 'user-agent': 'Mozilla/5.0 (collect; hop-up-tools)' } });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return await r.text();
}

const members = [];
for (const [group, g] of GROUP_PAGES) {
  const html = await load(g);
  const seen = new Set();
  let order = 0;
  for (const m of html.matchAll(MEMBER_RE)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    // 一覧の1枠ぶん（リンクから次の枠まで）に入っている英語表記を拾う
    const block = html.slice(m.index, m.index + 1500);
    const en = NAME_EN_RE.exec(block);
    members.push({ name: m[2].replace(/\s+/g, '').trim(), nameEn: en ? plain(en[1]) : null, group, path: m[1], order: ++order });
  }
  await sleep(700);
}

const missing = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, 0]));
let failed = 0;
for (const mem of members) {
  let html;
  try { html = await load(mem.path); } catch { failed++; await sleep(700); continue; }
  const got = {};
  for (const m of html.matchAll(DT_DD_RE)) {
    const label = plain(m[1]);
    for (const [key, jp] of Object.entries(FIELDS)) if (label === jp && !(key in got)) got[key] = plain(m[2]);
  }
  for (const key of Object.keys(FIELDS)) {
    mem[key] = got[key] ?? null;
    if (mem[key] == null) missing[key]++;
  }
  const hex = COLOR_HEX_RE.exec(html);
  mem.colorHex = hex ? hex[1].toLowerCase() : null;
  await sleep(700);
}

await mkdir(new URL('./data/', import.meta.url), { recursive: true });
const out = new URL('./data/members.json', import.meta.url);
await writeFile(out, JSON.stringify({ fetchedAt: new Date().toISOString(), members }, null, 2) + '\n');
console.log(`保存: ${members.length}人 → ${out.pathname}`);
console.log(`個人ページを取れなかった人: ${failed}`);
console.log('項目が取れなかった人数:', Object.entries(missing).map(([k, v]) => `${FIELDS[k]}=${v}`).join(' / '));
