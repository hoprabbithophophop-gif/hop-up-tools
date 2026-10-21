#!/usr/bin/env node
// 公式の名簿（src/data/officialAccounts.ts・officialBlogs.ts・officialSites.ts）を、公式サイト helloproject.com から拾い直す
// （Hop 決定 2026-10-21 案A「AI を通さずに作り直せる形」）。
//
// 拾い方は名簿のファイルの頭の注記のとおり: helloproject.com の各グループのページと /link/ に貼られたリンクの住所（href）だけを
// 正規表現で機械的に拾う。ページの本文の文章は扱わない・出力しない・保存しない（プロジェクトの決まり「公式サイトから集めた内容を AI に通さない」）。
// 画面に出すのは、ページごとに拾えたリンクの本数と、今の名簿との差（アカウント名・アメブロの ID・サイトの住所だけ）。
//
// 取りに行くのは robots.txt と、グループのページ7つと /link/ の、多くて9回。1回ごとに 1.5 秒空ける。
// robots.txt で禁止されている場所は取らない（その場所から拾う分は今の名簿のまま）。
//
// 書き換えるのは名簿の決まった所だけ:
//   officialAccounts.ts … グループごとの x・ig の並び、OTHER_X・OTHER_IG（/link/ にだけある分）
//   officialBlogs.ts    … グループごとの ids（足すだけ。消さない。下の「ブログは消さない」）
//   officialSites.ts    … OFFICIAL_SITES（/link/ の住所から、SNS・動画・ブログとショップを外した物。helloproject.com は先頭に残す）
// ブログの期間（BLOG_PERIODS）・呼び名（BLOG_NAMES）・グループの並びと名前・コメント・関数には触らない。
// ただし書き換えたファイルは、頭の「出どころ:」の行の拾った日付だけを書き換えた日に直す（Hop 依頼 2026-10-22）。
// ブログは消さない（Hop 決定 2026-10-22）: 名簿には更新が止まったブログや、今の公式サイトには無い過去のブログ（インターネットの記録庫から拾った物）も入っているため。
// 公式サイトで見つからなくなったブログは一覧に出すだけにする。/link/ にだけあってグループが分からない新しいブログも、一覧に出すだけで書かない。
// どのグループのページにも同じく貼られているリンク（ページの上下の共通の欄）は、そのグループの物とみなさず /link/ と同じ扱いにする。
// 番組などの名簿に入れないアカウントは EXCLUDED に書く（見つかっても書かず、一覧に出すだけ）。
//
// 使い方:
//   node scripts/sync-official-roster.mjs            # 見るだけ（名簿のファイルは書き換えない。--dry-run と同じ）
//   node scripts/sync-official-roster.mjs --dry-run  # 見るだけ
//   node scripts/sync-official-roster.mjs --write    # 差を一覧に出してから、名簿のファイルを書き換える
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  accounts: path.join(ROOT, 'src', 'data', 'officialAccounts.ts'),
  blogs: path.join(ROOT, 'src', 'data', 'officialBlogs.ts'),
  sites: path.join(ROOT, 'src', 'data', 'officialSites.ts'),
};

const SITE = 'https://www.helloproject.com';
const USER_AGENT = 'Mozilla/5.0 (roster; hop-up-tools)';
const WAIT_MS = 1500;
// 名簿の key と公式サイトのグループのページ（名簿の並びと同じ。key は officialBlogs.ts の OFFICIAL_BLOGS と同じ）
export const GROUP_PAGES = [
  ['morningmusume', '/morningmusume/'],
  ['angerme', '/angerme/'],
  ['juicejuice', '/juicejuice/'],
  ['tsubaki', '/tsubakifactory/'],
  ['beyooooonds', '/beyooooonds/'],
  ['ochanorma', '/ochanorma/'],
  ['rosy', '/rosychronicle/'],
];
const LINK_PAGE = '/link/';

// 公式サイトの住所から外す物。SNS・動画・ブログ（別の名簿で扱う物と、事実の出どころでない物）
const NON_SITE_HOSTS = [
  'x.com', 'twitter.com', 'instagram.com', 'ameblo.jp', 'youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com',
  'line.me', 'lin.ee', 'threads.net', 'note.com', 'apps.apple.com', 'play.google.com',
];
// ショップは事実の出どころでないので外す（officialSites.ts の頭の注記と同じ4つ【仮】）
const SHOP_HOSTS = ['elineupmall.com', 'helloshop.info', 'ody-books.com', 'helloproject.orical.jp'];
const OWN_HOST = 'helloproject.com';

// 公式サイトに貼られていても名簿に入れないアカウント。名簿の線引き（officialAccounts.ts の頭の注記・Hop 決定 2026-10-19）
// 「番組・フェスの公式アカウントは載せない」に当たる物。足す時は Hop が決める
//   ClipRadioKansai … ロージークロニクルのページに貼られている。名前からラジオ番組の物と見て外す（Hop 決定 2026-10-22「外す」。中身は確かめていない）
const EXCLUDED = { x: ['ClipRadioKansai'], ig: [] };

// X・Instagram の住所のうち、アカウントでない物（共有・検索・投稿など）
const X_RESERVED = new Set(['intent', 'share', 'search', 'hashtag', 'i', 'home', 'explore', 'settings', 'login', 'signup', 'tos', 'privacy', 'messages', 'notifications']);
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'direct']);

const lower = (s) => s.toLowerCase();

// ---- ページからリンクの住所だけを拾う ----

// 貼られたリンク（<a> の href）の値だけを取り出す。ページのほかの部分（本文の文章）は返さない。
// <link> の href（字の形や見た目の読み込み先）は貼られたリンクではないので拾わない（2026-10-22 初めて流した時に fonts.googleapis.com 等が混ざった）
export function extractHrefs(html) {
  const out = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/&amp;/g, '&').trim());
  return out;
}

const absolute = (href) => (href.startsWith('//') ? `https:${href}` : href);

// 住所の並びから、X・Instagram のアカウント名、アメブロの ID、ほかのサイトの住所（host）を拾う
export function classifyLinks(hrefs) {
  const x = [];
  const ig = [];
  const blog = [];
  const hosts = [];
  for (const raw of hrefs) {
    const href = absolute(raw);
    let mm;
    if ((mm = href.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i))) {
      if (!X_RESERVED.has(lower(mm[1]))) x.push(mm[1]);
      continue;
    }
    if ((mm = href.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})(?:[/?#]|$)/i))) {
      if (!IG_RESERVED.has(lower(mm[1]))) ig.push(mm[1]);
      continue;
    }
    if ((mm = href.match(/^https?:\/\/(?:s\.)?ameblo\.jp\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i))) {
      blog.push(mm[1]);
      continue;
    }
    if ((mm = href.match(/^https?:\/\/([^/?#:]+)/i))) hosts.push(lower(mm[1]).replace(/^www\./, ''));
  }
  return { x, ig, blog, hosts };
}

// ---- robots.txt ----

// User-agent: * の決まりだけを読む（この台本の名前で書かれた決まりは無い前提）。一番長く当たった決まりに従い、同じ長さなら Allow
export function robotsRules(text) {
  const rules = [];
  let agents = [];
  let inRules = false;
  for (const line of text.split(/\r?\n/)) {
    const l = line.replace(/#.*/, '').trim();
    if (!l) continue;
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = lower(m[1]);
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(lower(value));
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true;
      if (agents.includes('*') && value) rules.push({ allow: field === 'allow', path: value });
    }
  }
  return rules;
}
export function robotsAllows(rules, p) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (!re.test(p)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ---- 今の名簿を読む ----

const strings = (s) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

// グループの x・ig（OFFICIAL_ACCOUNT_GROUPS の中の、各グループの key の後ろにある最初の x: [ ] と ig: [ ]）
function groupArrayRange(src, key, field) {
  const start = src.indexOf('export const OFFICIAL_ACCOUNT_GROUPS');
  const at = src.indexOf(`key: "${key}",`, start);
  if (start < 0 || at < 0) throw new Error(`officialAccounts.ts に ${key} が見つからない`);
  const next = src.indexOf('key: "', at + 1);
  const open = src.indexOf(`${field}: [`, at);
  if (open < 0 || (next >= 0 && open > next)) throw new Error(`officialAccounts.ts の ${key} に ${field} が見つからない`);
  const from = open + field.length + 3;
  const to = src.indexOf(']', from);
  return [from, to];
}
function constArrayRange(src, head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`${head} が見つからない`);
  const from = at + head.length;
  const to = src.indexOf('];', from);
  return [from, to];
}
function blogLineRange(src, key) {
  const m = new RegExp(`\\{ key: "${key}", label: "[^"]*", ids: \\[`).exec(src);
  if (!m) throw new Error(`officialBlogs.ts に ${key} が見つからない`);
  const from = m.index + m[0].length;
  const to = src.indexOf(']', from);
  return [from, to];
}
const OTHER_X_HEAD = 'const OTHER_X = [';
const OTHER_IG_HEAD = 'const OTHER_IG = [';
const SITES_HEAD = 'export const OFFICIAL_SITES: string[] = [';
const BLOG_KEYS_RE = /\{ key: "([^"]+)", label: "[^"]*", ids: \[/g;

export function readRoster(src = { accounts: readFileSync(FILES.accounts, 'utf8'), blogs: readFileSync(FILES.blogs, 'utf8'), sites: readFileSync(FILES.sites, 'utf8') }) {
  const slice = (s, [a, b]) => strings(s.slice(a, b));
  const groups = {};
  for (const [key] of GROUP_PAGES) {
    groups[key] = { x: slice(src.accounts, groupArrayRange(src.accounts, key, 'x')), ig: slice(src.accounts, groupArrayRange(src.accounts, key, 'ig')) };
  }
  const blogs = {};
  for (const m of src.blogs.matchAll(BLOG_KEYS_RE)) blogs[m[1]] = slice(src.blogs, blogLineRange(src.blogs, m[1]));
  return {
    groups,
    otherX: slice(src.accounts, constArrayRange(src.accounts, OTHER_X_HEAD)),
    otherIg: slice(src.accounts, constArrayRange(src.accounts, OTHER_IG_HEAD)),
    blogs,
    sites: slice(src.sites, constArrayRange(src.sites, SITES_HEAD)),
  };
}

// ---- 名簿を書き換える（決まった並びの中身だけを差し替える） ----

const q = (s) => `"${s}"`;
const replaceRange = (src, [a, b], text) => src.slice(0, a) + text + src.slice(b);

// 並びの書き方は今の形に合わせる: 1行の並びは1行のまま、複数行の並びは1行に8つずつ
function formatArray(original, list, indent = '  ') {
  if (!original.includes('\n')) return list.map(q).join(', ');
  const lines = [];
  for (let i = 0; i < list.length; i += 8) lines.push(`${indent}${list.slice(i, i + 8).map(q).join(', ')},`);
  return `\n${lines.join('\n')}\n`;
}
const formatOnePerLine = (list) => `\n${list.map((s) => `  ${q(s)},`).join('\n')}\n`;

export function writeRoster(src, roster) {
  let accounts = src.accounts;
  // 後ろから差し替えると前の位置がずれない。各並びはその都度探し直す
  for (const [key] of GROUP_PAGES) {
    for (const field of ['ig', 'x']) {
      const r = groupArrayRange(accounts, key, field);
      accounts = replaceRange(accounts, r, formatArray(accounts.slice(...r), roster.groups[key][field]));
    }
  }
  for (const [head, list] of [[OTHER_X_HEAD, roster.otherX], [OTHER_IG_HEAD, roster.otherIg]]) {
    const r = constArrayRange(accounts, head);
    accounts = replaceRange(accounts, r, formatArray(accounts.slice(...r), list));
  }
  let blogs = src.blogs;
  for (const key of Object.keys(roster.blogs)) {
    const r = blogLineRange(blogs, key);
    blogs = replaceRange(blogs, r, roster.blogs[key].map(q).join(', '));
  }
  let sites = src.sites;
  {
    const r = constArrayRange(sites, SITES_HEAD);
    sites = replaceRange(sites, r, formatOnePerLine(roster.sites));
  }
  return { accounts, blogs, sites };
}

// ---- 拾った物と今の名簿を突き合わせる ----

// 今の並びに残る物は今の順・今の書き方のまま、新しい物は後ろに並べる（大文字小文字は区別しない）
function merge(current, found, { keepMissing = false } = {}) {
  const foundLower = new Map();
  for (const f of found) if (!foundLower.has(lower(f))) foundLower.set(lower(f), f);
  const currentLower = new Set(current.map(lower));
  const kept = current.filter((c) => keepMissing || foundLower.has(lower(c)));
  const added = [...foundLower.entries()].filter(([l]) => !currentLower.has(l)).map(([, f]) => f).sort();
  const gone = current.filter((c) => !foundLower.has(lower(c)));
  return { list: [...kept, ...added], added, gone };
}
const asciiSort = (list) => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// pages: { [key]: 拾った物 | null（取れなかった・取らなかった） }, link: 拾った物 | null
export function compare(current, pages, link) {
  const next = structuredClone(current);
  const diffs = [];
  const fetchedGroups = GROUP_PAGES.map(([k]) => k).filter((k) => pages[k]);
  // どのグループのページにもある物は、ページの共通の欄とみなす（グループのページが2つ以上取れた時だけ）
  const common = {};
  for (const kind of ['x', 'ig', 'blog']) {
    const sets = fetchedGroups.map((k) => new Set(pages[k][kind].map(lower)));
    common[kind] = sets.length >= 2 ? new Set([...sets[0]].filter((v) => sets.every((s) => s.has(v)))) : new Set();
  }
  const excluded = (kind, v) => (EXCLUDED[kind] ?? []).some((e) => lower(e) === lower(v));
  const seenExcluded = new Set();
  const groupOnly = (k, kind) =>
    pages[k][kind].filter((v) => {
      if (excluded(kind, v)) seenExcluded.add(v);
      return !common[kind].has(lower(v)) && !excluded(kind, v);
    });

  for (const [key] of GROUP_PAGES) {
    if (!pages[key]) {
      diffs.push({ where: `${key} のページ`, skipped: true });
      continue;
    }
    for (const kind of ['x', 'ig']) {
      const r = merge(current.groups[key][kind], groupOnly(key, kind));
      next.groups[key][kind] = r.list;
      diffs.push({ where: `officialAccounts.ts ${key} の ${kind === 'x' ? 'X' : 'Instagram'}`, added: r.added, gone: r.gone });
    }
  }
  // /link/ と共通の欄にあって、どのグループにも入っていないアカウント
  const inGroups = (kind) => new Set(GROUP_PAGES.flatMap(([k]) => next.groups[k][kind]).map(lower));
  if (link) {
    for (const [kind, field, label] of [['x', 'otherX', 'OTHER_X'], ['ig', 'otherIg', 'OTHER_IG']]) {
      const grouped = inGroups(kind);
      const found = [...link[kind], ...[...common[kind]].map((l) => fetchedGroups.flatMap((k) => pages[k][kind]).find((v) => lower(v) === l))].filter((v) => {
        if (excluded(kind, v)) seenExcluded.add(v);
        return !grouped.has(lower(v)) && !excluded(kind, v);
      });
      const r = merge(current[field], found);
      next[field] = asciiSort(r.list);
      diffs.push({ where: `officialAccounts.ts ${label}`, added: r.added, gone: r.gone });
    }
  } else diffs.push({ where: '/link/ のページ', skipped: true });

  if (seenExcluded.size) diffs.push({ where: '公式サイトにあったが名簿に入れないアカウント（台本の EXCLUDED）', added: [...seenExcluded], gone: [], reportOnly: true });

  // ブログ: グループのページで見つかった新しい ID を足す。消さない
  const seenBlogs = new Set([...fetchedGroups.flatMap((k) => pages[k].blog), ...(link ? link.blog : [])].map(lower));
  const listedBlogs = new Set(Object.values(current.blogs).flat().map(lower));
  for (const [key] of GROUP_PAGES) {
    if (!pages[key] || !current.blogs[key]) continue;
    const fresh = groupOnly(key, 'blog').filter((v) => !listedBlogs.has(lower(v)));
    const r = merge(current.blogs[key], fresh, { keepMissing: true });
    next.blogs[key] = r.list;
    diffs.push({ where: `officialBlogs.ts ${key} の ids（足すだけ）`, added: r.added, gone: [] });
  }
  const assigned = new Set(Object.values(next.blogs).flat().map(lower));
  const unassigned = [...new Set([...(link ? link.blog : []), ...fetchedGroups.flatMap((k) => pages[k].blog.filter((v) => common.blog.has(lower(v))))])].filter((v) => !assigned.has(lower(v)));
  diffs.push({ where: 'グループが分からない新しいブログ（書かない）', added: unassigned, gone: [], reportOnly: true });
  // 全部のページが取れた時だけ（取れなかったページの分まで「見つからない」に数えないように）
  if (link && fetchedGroups.length === GROUP_PAGES.length) {
    const missingBlogs = Object.values(current.blogs).flat().filter((v) => !seenBlogs.has(lower(v)));
    diffs.push({ where: '公式サイトで見つからなかった名簿のブログ（消さない）', added: [], gone: missingBlogs, reportOnly: true });
  }

  // サイト: /link/ の住所から、SNS 等とショップを外す。helloproject.com は先頭に残す
  if (link) {
    const isSub = (h, base) => h === base || h.endsWith(`.${base}`);
    const found = [...new Set(link.hosts.map((h) => lower(h).replace(/^www\./, "")))].filter((h) => h !== OWN_HOST && !NON_SITE_HOSTS.some((b) => isSub(h, b)) && !SHOP_HOSTS.includes(h));
    const rest = current.sites.filter((s) => s !== OWN_HOST);
    const r = merge(rest, found);
    next.sites = [OWN_HOST, ...r.list];
    diffs.push({ where: 'officialSites.ts OFFICIAL_SITES', added: r.added, gone: r.gone });
  }
  return { next, diffs, commonCounts: { x: common.x.size, ig: common.ig.size, blog: common.blog.size } };
}

// ---- 取りに行く ----

async function get(p) {
  const r = await fetch(SITE + p, { headers: { 'user-agent': USER_AGENT } });
  return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
}

async function main() {
  const write = process.argv.includes('--write');
  if (write && process.argv.includes('--dry-run')) throw new Error('--write と --dry-run は一緒に使えない');
  console.log(write ? '書き換える動かし方（--write）' : '見るだけ（名簿のファイルは書き換えない）');

  const robots = await get('/robots.txt');
  const rules = robots.ok ? robotsRules(robots.text) : [];
  console.log(`robots.txt: ${robots.status}・User-agent: * の決まり ${rules.length} 件`);
  const plan = [...GROUP_PAGES.map(([k, p]) => [k, p]), ['link', LINK_PAGE]];
  const pages = {};
  let link = null;
  for (const [key, p] of plan) {
    if (!robotsAllows(rules, p)) {
      console.log(`  ${p}: robots.txt で禁止されているので取らない`);
      continue;
    }
    await sleep(WAIT_MS);
    let found = null;
    try {
      const r = await get(p);
      if (r.ok) found = classifyLinks(extractHrefs(r.text));
      console.log(`  ${p}: ${r.status}${found ? `・リンク X ${found.x.length}・Instagram ${found.ig.length}・アメブロ ${found.blog.length}・ほかのサイト ${found.hosts.length}` : '・取れなかった'}`);
    } catch (e) {
      console.log(`  ${p}: 取れなかった（${e.code ?? e.name}）`);
    }
    if (key === 'link') link = found;
    else pages[key] = found;
  }

  const src = { accounts: readFileSync(FILES.accounts, 'utf8'), blogs: readFileSync(FILES.blogs, 'utf8'), sites: readFileSync(FILES.sites, 'utf8') };
  const current = readRoster(src);
  const { next, diffs, commonCounts } = compare(current, pages, link);
  console.log(`どのグループのページにもあるリンク（共通の欄とみなした物）: X ${commonCounts.x}・Instagram ${commonCounts.ig}・アメブロ ${commonCounts.blog}`);
  console.log('');
  console.log('今の名簿との差:');
  let changes = 0;
  for (const d of diffs) {
    if (d.skipped) {
      console.log(`  ${d.where}: 取れなかったので今の名簿のまま`);
      continue;
    }
    if (d.added.length === 0 && d.gone.length === 0) continue;
    if (!d.reportOnly) changes += d.added.length + d.gone.length;
    console.log(`  ${d.where}`);
    if (d.added.length) console.log(`    新しく見つかった ${d.added.length}: ${d.added.join(', ')}`);
    if (d.gone.length) console.log(`    無くなった ${d.gone.length}: ${d.gone.join(', ')}`);
  }
  console.log(changes === 0 ? '  書き換える差は無い' : `  書き換える差は ${changes} 件`);

  if (!write) {
    console.log('\n見るだけなので名簿のファイルは書き換えていない（書き換えるには --write）');
    return;
  }
  if (changes === 0) return;
  const out = writeRoster(src, next);
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const k of Object.keys(FILES)) {
    if (out[k] !== src[k]) {
      // 頭の「出どころ:」の行の拾った日付だけを今日に直す（ほかのコメントには触らない）
      const dated = out[k].replace(/^(\/\/ 出どころ:.*?)\d{4}-\d{2}-\d{2}/m, `$1${today}`);
      writeFileSync(FILES[k], dated);
      console.log(`書き換えた: ${path.relative(ROOT, FILES[k])}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`止まった: ${e.message}`);
    process.exit(1);
  });
}
