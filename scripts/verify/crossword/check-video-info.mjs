// チャンネル名と「見られるか」を答える受付係（functions/api/crossword-video-info.ts。Hop 決定 2026-10-21「正式な窓口に切り替えてから出す」）を、
// 本物のファイルのまま手元で動かして確かめる。本番にもプレビューにも YouTube にも通信しない。
// YouTube（googleapis.com）・数えの棚（rate_limit_log）・エッジ（caches.default）は、この台本の作り物が受ける。
//  (1) 見られる動画 → { status: "ok", channel }。エッジに 6時間置く。鍵は返事に出ない
//  (2) 同じ番号はエッジから返し、YouTube にも数えの棚にも聞かない（余計な引数を付けても同じ）
//  (3) 見られない → { status: "gone" }（動画が無い・非公開・埋め込み禁止・年齢制限）。エッジに 1時間置く。限定公開は見られる
//  (4) 分からない → 503 { status: "unknown" }（鍵が無い・YouTube が 200 以外・通信の失敗・名前が読めない）。エッジに置かない
//  (5) 番号の形が違えば 400。YouTube に聞かない
//  (6) 接続元ごとに 1時間 120回まで・全員合わせて 1時間 125回まで。超えたら 429 で YouTube に聞かない。数えは生の IP でなくハッシュで残す。
//      先に接続元ごとを数え、達していれば記録を書かずに断る。記録を書いてから数え直し、同時に叩かれた分も断る。
//      数えは HEAD + Prefer: count=exact で件数だけを聞く。照会・記録に失敗したら 503 で YouTube に聞かない。
//      掃除はこのエンドポイントの 1時間より古い物だけ
//  (7) 鍵は返事にも記録（console）にも出ない
//  (8) Sec-Fetch-Site が same-origin 以外なら 403 でエッジにも数えにも YouTube にも行かない。same-origin と付いていない時は通る
// 使い方: node scripts/verify/crossword/check-video-info.mjs（引数なし）
import { openFunctions, FAKE_SUPA, FAKE_ENV, callFunction } from './_localFunctions.mjs';

const KEY = 'FAKE-YOUTUBE-KEY-0123456789';
const ENV = { ...FAKE_ENV, YOUTUBE_API_KEY: KEY };
const FIELDS = 'items(id,snippet/channelTitle,status/privacyStatus,status/embeddable,contentDetails/contentRating/ytRating)';

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

// ---- 作り物のエッジ ----
const edge = new Map(); // URL → { status, headers, body }
globalThis.caches = {
  default: {
    async match(req) {
      const e = edge.get(typeof req === 'string' ? req : req.url);
      return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
    },
    async put(req, res) {
      edge.set(typeof req === 'string' ? req : req.url, { status: res.status, headers: [...res.headers], body: await res.text() });
    },
  },
};

// ---- 作り物の YouTube と数えの棚 ----
const yt = { calls: [], mode: () => ({ status: 200, body: { items: [] } }) };
// 数えの棚。rows は { ip_hash, endpoint, created_at(ミリ秒) }。HEAD は絞り込みに合う件数を Content-Range で返す
const rl = { heads: 0, gets: 0, posts: [], deletes: [], deleted: 0, rows: [], onPost: null, failHead: false, failPost: false, noRange: false, headInit: [] };
const rowMatch = (row, params) => [...params].every(([col, cond]) => {
  if (col === 'select') return true;
  if (cond.startsWith('eq.')) return String(row[col]) === cond.slice(3);
  if (cond.startsWith('gt.')) return row[col] > Date.parse(cond.slice(3));
  if (cond.startsWith('lt.')) return row[col] < Date.parse(cond.slice(3));
  throw new Error(`作り物の数えの棚は ${col}=${cond} を真似ていない`);
});
const outside = [];
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.origin === 'https://www.googleapis.com' && url.pathname === '/youtube/v3/videos') {
    yt.calls.push(url);
    const m = yt.mode(url.searchParams.get('id'));
    // 失敗の中身に鍵入りの住所が混ざっても漏れないかを見るため、わざと住所ごと投げる
    if (m.throw) throw new Error(`fetch failed: ${url.href}`);
    return jsonRes(m.body ?? { error: { message: `bad request for ${url.href}` } }, m.status);
  }
  if (url.origin === FAKE_SUPA && url.pathname === '/rest/v1/rate_limit_log') {
    if (method === 'HEAD') {
      rl.heads++;
      rl.headInit.push({ url, prefer: init.headers?.Prefer });
      if (rl.failHead === 'throw') throw new Error('照会の通信の失敗');
      if (rl.failHead) return new Response(null, { status: 500 });
      // 件数を頼まれない時・件数を返さない場面では Content-Range を付けない
      if (rl.noRange || init.headers?.Prefer !== 'count=exact') return new Response(null, { status: 200 });
      const n = rl.rows.filter((row) => rowMatch(row, url.searchParams)).length;
      return new Response(null, { status: 200, headers: { 'Content-Range': n === 0 ? '*/0' : `0-${n - 1}/${n}` } });
    }
    if (method === 'GET') {
      rl.gets++;
      return jsonRes([]);
    }
    if (method === 'POST') {
      if (rl.failPost === 'throw') throw new Error('記録の通信の失敗');
      if (rl.failPost) return new Response(null, { status: 500 });
      const b = JSON.parse(init.body);
      rl.posts.push(b);
      rl.rows.push({ ...b, created_at: Date.now() });
      rl.onPost?.(b);
      return new Response(null, { status: 201 });
    }
    if (method === 'DELETE') {
      rl.deletes.push(url);
      const before = rl.rows.length;
      rl.rows = rl.rows.filter((row) => !rowMatch(row, url.searchParams));
      rl.deleted += before - rl.rows.length;
      return new Response(null, { status: 204 });
    }
  }
  outside.push(`${method} ${url.href}`);
  throw new Error(`外への通信を止めた: ${url.origin}`);
};
const shelf = { fetch: fakeFetch };

// 記録（console）に出た物を全部控える
const logged = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    if (k !== 'log' || !String(a[0]).match(/^(OK|NG) /)) logged.push(a.map(String).join(' '));
    orig(...a);
  };
}

const item = ({ channel = 'テストチャンネル', privacy = 'public', embeddable = true, rating } = {}) => ({
  items: [{ id: 'x', snippet: { channelTitle: channel }, status: { privacyStatus: privacy, embeddable }, contentDetails: { contentRating: rating ? { ytRating: rating } : {} } }],
});

const fns = await openFunctions();
try {
  const { onRequestGet } = await fns.load('functions/api/crossword-video-info.ts');
  const ask = (id, { env = ENV, extra = '', ip = '203.0.113.7', site = 'same-origin' } = {}) =>
    callFunction(onRequestGet, shelf, {
      method: 'GET',
      path: `/api/crossword-video-info${id === null ? '' : `?id=${encodeURIComponent(id)}`}${extra}`,
      env,
      headers: { 'CF-Connecting-IP': ip, ...(site === null ? {} : { 'Sec-Fetch-Site': site }) },
    }).then(async (r) => r);
  const cc = (id) => edge.get(`https://local.invalid/api/crossword-video-info?id=${id}`)?.headers.find(([k]) => k === 'cache-control')?.[1];
  const texts = [];
  const askT = async (...a) => {
    const r = await ask(...a);
    texts.push(r.text);
    return r;
  };

  // ---- (1) 見られる動画 ----
  yt.mode = () => ({ status: 200, body: item() });
  let r = await askT('AAAAAAAAAA1');
  check(r.status === 200 && r.j?.status === 'ok' && r.j?.channel === 'テストチャンネル', `(1) 見られる動画は ok とチャンネル名（${r.status} ${r.text}）`);
  check(yt.calls.length === 1, `(1) YouTube に1回聞く（${yt.calls.length}回）`);
  const u = yt.calls[0];
  check(
    u && u.searchParams.get('part') === 'snippet,status,contentDetails' && u.searchParams.get('id') === 'AAAAAAAAAA1' && u.searchParams.get('fields') === FIELDS && u.searchParams.get('key') === KEY,
    '(1) 聞き方は videos.list・part=snippet,status,contentDetails・決めた fields・鍵つき',
  );
  check(cc('AAAAAAAAAA1') === 'public, s-maxage=21600', `(1) エッジに 6時間置く（${cc('AAAAAAAAAA1')}）`);
  check(rl.heads === 3 && rl.posts.length === 1 && rl.posts[0].endpoint === 'crossword-video-info', `(1) エッジに無い時は数える（件数の照会 ${rl.heads}・記録 ${rl.posts.length}・${rl.posts[0]?.endpoint}）`);
  check(rl.gets === 0, `(6) 数えは行を取ってこない（GET ${rl.gets}回）`);
  check(
    rl.headInit.length === 3 && rl.headInit.every((h) => h.prefer === 'count=exact' && h.url.searchParams.get('endpoint') === 'eq.crossword-video-info'),
    '(6) 数えは HEAD + Prefer: count=exact で、このエンドポイントの分だけ',
  );
  check(/^[0-9a-f]{64}$/.test(rl.posts[0]?.ip_hash ?? '') && !JSON.stringify(rl.posts).includes('203.0.113.7'), '(6) 数えは生の IP でなくハッシュで残す');
  {
    const d = rl.deletes[0];
    const lt = d ? Date.parse((d.searchParams.get('created_at') || '').replace(/^lt\./, '')) : NaN;
    const age = Date.now() - lt;
    check(
      rl.deletes.length === 1 && d.searchParams.get('endpoint') === 'eq.crossword-video-info' && age > 59 * 60e3 && age < 61 * 60e3,
      `(6) 掃除はこのエンドポイントの 1時間より古い物だけ（${rl.deletes.length}回・${d?.searchParams.get('endpoint')}・${Math.round(age / 60e3)}分より前）`,
    );
  }

  // 長い名前は 100字まで・前後の空白は落とす
  yt.mode = () => ({ status: 200, body: item({ channel: `  ${'あ'.repeat(150)}  ` }) });
  r = await askT('AAAAAAAAAA2');
  check(r.j?.status === 'ok' && r.j?.channel === 'あ'.repeat(100), `(1) 長い名前は 100字まで（${r.j?.channel?.length}字）`);
  // 限定公開は見られる
  yt.mode = () => ({ status: 200, body: item({ privacy: 'unlisted' }) });
  r = await askT('AAAAAAAAAA3');
  check(r.j?.status === 'ok', `(3) 限定公開は見られる（${r.text}）`);

  // ---- (2) エッジに当たる ----
  {
    const before = { yt: yt.calls.length, heads: rl.heads, posts: rl.posts.length };
    yt.mode = () => ({ status: 500 });
    r = await askT('AAAAAAAAAA1');
    check(r.status === 200 && r.j?.status === 'ok' && r.j?.channel === 'テストチャンネル', `(2) 同じ番号はエッジの答えを返す（${r.text}）`);
    r = await askT('AAAAAAAAAA1', { extra: '&x=1' });
    check(r.j?.status === 'ok', '(2) 余計な引数を付けてもエッジの答えを返す');
    check(yt.calls.length === before.yt, `(2) エッジに当たった時は YouTube に聞かない（${yt.calls.length - before.yt}回）`);
    check(rl.heads === before.heads && rl.posts.length === before.posts, '(2) エッジに当たった時は数えない');
  }

  // ---- (3) 見られない ----
  const goneCases = [
    ['AAAAAAAAAB1', '動画が無い（items が空）', { status: 200, body: { items: [] } }],
    ['AAAAAAAAAB2', '動画が無い（items が無い）', { status: 200, body: {} }],
    ['AAAAAAAAAB3', '非公開', { status: 200, body: item({ privacy: 'private' }) }],
    ['AAAAAAAAAB4', '埋め込み禁止', { status: 200, body: item({ embeddable: false }) }],
    ['AAAAAAAAAB5', '年齢制限', { status: 200, body: item({ rating: 'ytAgeRestricted' }) }],
  ];
  for (const [id, label, m] of goneCases) {
    yt.mode = () => m;
    r = await askT(id);
    check(r.status === 200 && r.j?.status === 'gone' && !('channel' in (r.j ?? {})), `(3) ${label} → gone（${r.status} ${r.text}）`);
    check(cc(id) === 'public, s-maxage=3600', `(3) ${label} はエッジに 1時間置く（${cc(id)}）`);
  }

  // ---- (4) 分からない ----
  const unknownCases = [
    ['AAAAAAAAAC1', 'YouTube が 403（上限超え・鍵の不調）', { status: 403 }],
    ['AAAAAAAAAC2', 'YouTube が 500', { status: 500 }],
    ['AAAAAAAAAC3', 'YouTube が 404', { status: 404 }],
    ['AAAAAAAAAC4', '通信の失敗', { throw: true }],
    ['AAAAAAAAAC5', 'チャンネル名が空', { status: 200, body: item({ channel: '   ' }) }],
  ];
  for (const [id, label, m] of unknownCases) {
    yt.mode = () => m;
    const n0 = yt.calls.length;
    r = await askT(id);
    check(r.status === 503 && r.j?.status === 'unknown', `(4) ${label} → 503 unknown（${r.status} ${r.text}）`);
    check(!edge.has(`https://local.invalid/api/crossword-video-info?id=${id}`), `(4) ${label} はエッジに置かない`);
    r = await askT(id);
    check(yt.calls.length === n0 + 2, `(4) ${label} の後にもう一度聞くと YouTube に聞き直す`);
  }
  {
    const n0 = yt.calls.length;
    yt.mode = () => ({ status: 200, body: item() });
    r = await askT('AAAAAAAAAC6', { env: { ...FAKE_ENV } });
    check(r.status === 503 && r.j?.status === 'unknown' && yt.calls.length === n0, `(4) 鍵が無い → 503 unknown・YouTube に聞かない（${r.status} ${r.text}）`);
  }

  // ---- (5) 番号の形 ----
  for (const bad of [null, '', 'short', 'AAAAAAAAAAAA', 'AAAAA!AAAAA', 'AAAAA AAAAA', 'ＡAAAAAAAAAA']) {
    const n0 = yt.calls.length;
    r = await askT(bad);
    check(r.status === 400 && yt.calls.length === n0, `(5) 番号 ${JSON.stringify(bad)} → 400・YouTube に聞かない（${r.status}）`);
  }

  // ---- (6) 回数の上限 ----
  const myHash = rl.posts[0].ip_hash; // 203.0.113.7 のハッシュ
  const seed = (n, ipHash, agoMs = 60e3) => {
    for (let i = 0; i < n; i++) rl.rows.push({ ip_hash: ipHash, endpoint: 'crossword-video-info', created_at: Date.now() - agoMs });
  };
  const reset = () => {
    rl.rows = [];
    rl.onPost = null;
    rl.failHead = false;
    rl.failPost = false;
    rl.noRange = false;
  };
  const noEdge = (id) => !edge.has(`https://local.invalid/api/crossword-video-info?id=${id}`);
  yt.mode = () => ({ status: 200, body: item() });

  reset();
  seed(119, myHash);
  r = await askT('AAAAAAAAAD1');
  check(r.status === 200 && r.j?.status === 'ok', `(6) 接続元ごと 1時間に 119回までなら通す（${r.status}）`);

  reset();
  seed(120, myHash);
  {
    const n0 = yt.calls.length;
    const p0 = rl.posts.length;
    r = await askT('AAAAAAAAAD2');
    check(r.status === 429 && r.j?.status === 'unknown' && yt.calls.length === n0, `(6) 接続元ごと 120回に達したら 429・YouTube に聞かない（${r.status} ${r.text}）`);
    check(rl.posts.length === p0, '(6) 先の数えで断った回は記録を書かない（攻撃で記録が膨らまない）');
    check(noEdge('AAAAAAAAAD2'), '(6) 断った答えはエッジに置かない');
    r = await askT('AAAAAAAAAA1');
    check(r.status === 200 && r.j?.status === 'ok', '(6) 上限に達していてもエッジにある番号は答える');
  }

  // 1時間より前の記録は数えず、掃除で消える
  reset();
  seed(200, myHash, 61 * 60e3);
  seed(200, 'other', 61 * 60e3);
  r = await askT('AAAAAAAAAD3');
  check(r.status === 200 && r.j?.status === 'ok', `(6) 1時間より前の記録は数えない（${r.status}）`);
  check(rl.rows.length === 1 && rl.rows.every((row) => row.created_at > Date.now() - 60 * 60e3), `(6) 掃除で1時間より古い記録が消える（残り ${rl.rows.length}行）`);
  {
    // ほかのエンドポイントの古い記録は消さない
    rl.rows.push({ ip_hash: 'x', endpoint: 'hai-to-diamond-comments', created_at: Date.now() - 61 * 60e3 });
    r = await askT('AAAAAAAAAD3');
    r = await askT('AAAAAAAAAE3');
    check(rl.rows.some((row) => row.endpoint === 'hai-to-diamond-comments'), '(6) ほかのエンドポイントの古い記録には触らない');
  }

  // 同時に叩かれた場面の代わり: 先の数えは 119 だが、記録を書く間にほかの回が 2つ書いた
  reset();
  seed(119, myHash);
  rl.onPost = () => seed(2, myHash, 0);
  {
    const n0 = yt.calls.length;
    const p0 = rl.posts.length;
    r = await askT('AAAAAAAAAD4');
    check(r.status === 429 && r.j?.status === 'unknown' && yt.calls.length === n0, `(6) 書いた後の数え直しで接続元ごと 120回を超えたら 429・YouTube に聞かない（${r.status} ${r.text}）`);
    check(rl.posts.length === p0 + 1, '(6) 数え直しで断った回の記録は残る（書いた後に数え直すため）');
    check(noEdge('AAAAAAAAAD4'), '(6) 数え直しで断った答えはエッジに置かない');
  }

  // 全員合わせて 1時間 125回
  reset();
  seed(124, 'other');
  r = await askT('AAAAAAAAAD5');
  check(r.status === 200 && r.j?.status === 'ok', `(6) 全体で自分を含めて 125回までなら通す（${r.status}）`);
  reset();
  seed(125, 'other');
  {
    const n0 = yt.calls.length;
    r = await askT('AAAAAAAAAD6');
    check(r.status === 429 && r.j?.status === 'unknown' && yt.calls.length === n0, `(6) 全体 125回に達していたら 429・YouTube に聞かない（${r.status} ${r.text}）`);
    check(noEdge('AAAAAAAAAD6'), '(6) 全体の上限で断った答えはエッジに置かない');
  }
  reset();
  seed(124, 'other');
  rl.onPost = () => seed(1, 'other2', 0);
  {
    const n0 = yt.calls.length;
    r = await askT('AAAAAAAAAD7');
    check(r.status === 429 && yt.calls.length === n0, `(6) 書いた後の数え直しで全体 125回を超えたら 429・YouTube に聞かない（${r.status}）`);
  }

  // 照会・記録の失敗は通さない
  for (const [label, set] of [
    ['照会が 500', () => { rl.failHead = true; }],
    ['照会の通信の失敗', () => { rl.failHead = 'throw'; }],
    ['件数が読めない（Content-Range が無い）', () => { rl.noRange = true; }],
  ]) {
    reset();
    set();
    const n0 = yt.calls.length;
    const p0 = rl.posts.length;
    r = await askT('AAAAAAAAAD8');
    check(r.status === 503 && r.j?.status === 'unknown' && yt.calls.length === n0 && rl.posts.length === p0, `(6) ${label} → 503 unknown・記録を書かず YouTube に聞かない（${r.status} ${r.text}）`);
    check(noEdge('AAAAAAAAAD8'), `(6) ${label} の答えはエッジに置かない`);
  }
  for (const [label, set] of [
    ['記録が 500', () => { rl.failPost = true; }],
    ['記録の通信の失敗', () => { rl.failPost = 'throw'; }],
    ['数え直しの照会の失敗', () => { rl.onPost = () => { rl.failHead = true; }; }],
  ]) {
    reset();
    set();
    const n0 = yt.calls.length;
    r = await askT('AAAAAAAAAD9');
    check(r.status === 503 && r.j?.status === 'unknown' && yt.calls.length === n0, `(6) ${label} → 503 unknown・YouTube に聞かない（${r.status} ${r.text}）`);
    check(noEdge('AAAAAAAAAD9'), `(6) ${label} の答えはエッジに置かない`);
  }
  reset();

  // ---- (8) 呼ばれ元 ----
  for (const site of ['cross-site', 'same-site', 'none']) {
    const before = { yt: yt.calls.length, heads: rl.heads, posts: rl.posts.length };
    r = await askT('AAAAAAAAAF1', { site });
    check(
      r.status === 403 && r.j?.status === 'unknown' && yt.calls.length === before.yt && rl.heads === before.heads && rl.posts.length === before.posts,
      `(8) Sec-Fetch-Site: ${site} → 403・数えにも YouTube にも行かない（${r.status} ${r.text}）`,
    );
  }
  check(noEdge('AAAAAAAAAF1'), '(8) よそから断った答えはエッジに置かない');
  r = await askT('AAAAAAAAAA1', { site: 'cross-site' });
  check(r.status === 403, `(8) エッジにある番号でも、よそからは 403（${r.status}）`);
  r = await askT('AAAAAAAAAF2', { site: 'same-origin' });
  check(r.status === 200 && r.j?.status === 'ok', `(8) same-origin は通る（${r.status}）`);
  r = await askT('AAAAAAAAAF3', { site: null });
  check(r.status === 200 && r.j?.status === 'ok', `(8) Sec-Fetch-Site が付いていない時は通る（${r.status}）`);
  reset();

  // ---- (7) 鍵が出ない ----
  check(texts.length > 0 && texts.every((t) => !t.includes(KEY)), `(7) 鍵はどの返事にも出ない（${texts.length}件を見た）`);
  check(logged.every((l) => !l.includes(KEY) && !l.includes('googleapis.com')), `(7) 鍵も YouTube の住所も記録に出ない（記録 ${logged.length}行）`);
  check(outside.length === 0, `(7) 作り物の外への通信は無い（${outside.join(', ') || 'なし'}）`);
} finally {
  await fns.close();
}

console.log(fail === 0 ? '\nALL OK' : `\nNG ${fail}件`);
process.exit(fail === 0 ? 0 : 1);
