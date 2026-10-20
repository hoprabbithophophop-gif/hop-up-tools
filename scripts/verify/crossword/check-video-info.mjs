// チャンネル名と「見られるか」を答える受付係（functions/api/crossword-video-info.ts。Hop 決定 2026-10-21「正式な窓口に切り替えてから出す」）を、
// 本物のファイルのまま手元で動かして確かめる。本番にもプレビューにも YouTube にも通信しない。
// YouTube（googleapis.com）・数えの棚（rate_limit_log）・エッジ（caches.default）は、この台本の作り物が受ける。
//  (1) 見られる動画 → { status: "ok", channel }。エッジに 6時間置く。鍵は返事に出ない
//  (2) 同じ番号はエッジから返し、YouTube にも数えの棚にも聞かない（余計な引数を付けても同じ）
//  (3) 見られない → { status: "gone" }（動画が無い・非公開・埋め込み禁止・年齢制限）。エッジに 1時間置く。限定公開は見られる
//  (4) 分からない → 503 { status: "unknown" }（鍵が無い・YouTube が 200 以外・通信の失敗・名前が読めない）。エッジに置かない
//  (5) 番号の形が違えば 400。YouTube に聞かない
//  (6) 接続元ごとに 1時間 120回まで。超えたら 429 で YouTube に聞かない。数えは生の IP でなくハッシュで残す
//  (7) 鍵は返事にも記録（console）にも出ない
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
const rl = { gets: 0, posts: [], deletes: 0, count: 0 };
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
    if (method === 'GET') {
      rl.gets++;
      return jsonRes(Array.from({ length: rl.count }, (_, i) => ({ id: i })));
    }
    if (method === 'POST') {
      rl.posts.push(JSON.parse(init.body));
      return new Response(null, { status: 201 });
    }
    if (method === 'DELETE') {
      rl.deletes++;
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
  const ask = (id, { env = ENV, extra = '', ip = '203.0.113.7' } = {}) =>
    callFunction(onRequestGet, shelf, {
      method: 'GET',
      path: `/api/crossword-video-info${id === null ? '' : `?id=${encodeURIComponent(id)}`}${extra}`,
      env,
      headers: { 'CF-Connecting-IP': ip },
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
  check(rl.gets === 1 && rl.posts.length === 1 && rl.posts[0].endpoint === 'crossword-video-info', `(1) エッジに無い時は数える（照会 ${rl.gets}・記録 ${rl.posts.length}・${rl.posts[0]?.endpoint}）`);
  check(/^[0-9a-f]{64}$/.test(rl.posts[0]?.ip_hash ?? '') && !JSON.stringify(rl.posts).includes('203.0.113.7'), '(6) 数えは生の IP でなくハッシュで残す');
  check(rl.deletes === 1, `(6) 1時間より古い数えを掃除する（${rl.deletes}回）`);

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
    const before = { yt: yt.calls.length, gets: rl.gets, posts: rl.posts.length };
    yt.mode = () => ({ status: 500 });
    r = await askT('AAAAAAAAAA1');
    check(r.status === 200 && r.j?.status === 'ok' && r.j?.channel === 'テストチャンネル', `(2) 同じ番号はエッジの答えを返す（${r.text}）`);
    r = await askT('AAAAAAAAAA1', { extra: '&x=1' });
    check(r.j?.status === 'ok', '(2) 余計な引数を付けてもエッジの答えを返す');
    check(yt.calls.length === before.yt, `(2) エッジに当たった時は YouTube に聞かない（${yt.calls.length - before.yt}回）`);
    check(rl.gets === before.gets && rl.posts.length === before.posts, '(2) エッジに当たった時は数えない');
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
  yt.mode = () => ({ status: 200, body: item() });
  rl.count = 119;
  r = await askT('AAAAAAAAAD1');
  check(r.status === 200 && r.j?.status === 'ok', `(6) 1時間に 119回までなら通す（${r.status}）`);
  rl.count = 120;
  {
    const n0 = yt.calls.length;
    const p0 = rl.posts.length;
    r = await askT('AAAAAAAAAD2');
    check(r.status === 429 && r.j?.status === 'unknown' && yt.calls.length === n0, `(6) 120回に達したら 429・YouTube に聞かない（${r.status} ${r.text}）`);
    check(rl.posts.length === p0, '(6) 断った回は数えに足さない（数えるのは通した回だけ）');
    check(!edge.has('https://local.invalid/api/crossword-video-info?id=AAAAAAAAAD2'), '(6) 断った答えはエッジに置かない');
    r = await askT('AAAAAAAAAA1');
    check(r.status === 200 && r.j?.status === 'ok', '(6) 上限に達していてもエッジにある番号は答える');
  }
  rl.count = 0;

  // ---- (7) 鍵が出ない ----
  check(texts.length > 0 && texts.every((t) => !t.includes(KEY)), `(7) 鍵はどの返事にも出ない（${texts.length}件を見た）`);
  check(logged.every((l) => !l.includes(KEY) && !l.includes('googleapis.com')), `(7) 鍵も YouTube の住所も記録に出ない（記録 ${logged.length}行）`);
  check(outside.length === 0, `(7) 作り物の外への通信は無い（${outside.join(', ') || 'なし'}）`);
} finally {
  await fns.close();
}

console.log(fail === 0 ? '\nALL OK' : `\nNG ${fail}件`);
process.exit(fail === 0 ? 0 : 1);
