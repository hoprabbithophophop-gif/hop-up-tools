// プレビュー（または本番）の住所で、看板のタグが決まりどおりに出ているかを生の <head> から読む。
// 使い方: `node scripts/verify/hai-to-diamond/check-card-meta.mjs [住所]`（省略時はプレビュー）
const BASE = process.argv[2] || 'https://feature-hai-to-diamond.hop-up-tools.pages.dev';
const ALL = '/ogp/hai-to-diamond.png';
const cases = [
  ['/hai-to-diamond', ALL, '/hai-to-diamond'],
  ['/hai-to-diamond/', ALL, '/hai-to-diamond'],
  ['/hai-to-diamond/nishida/2', '/ogp/hai-to-diamond/nishida-2.jpg', '/hai-to-diamond/nishida/2'],
  ['/hai-to-diamond/nishida/2/', '/ogp/hai-to-diamond/nishida-2.jpg', '/hai-to-diamond/nishida/2'],
  ['/hai-to-diamond/kiyono/3', '/ogp/hai-to-diamond/kiyono-3.jpg', '/hai-to-diamond/kiyono/3'],
  ['/hai-to-diamond/yamazaki/1', '/ogp/hai-to-diamond/yamazaki-1.jpg', '/hai-to-diamond/yamazaki/1'],
  ['/hai-to-diamond/unknown/9', ALL, '/hai-to-diamond'],
  ['/hai-to-diamond/nishida', ALL, '/hai-to-diamond'],
  ['/hai-to-diamond/nishida/4', ALL, '/hai-to-diamond'],
  ['/hai-to-diamond/nishida/02', ALL, '/hai-to-diamond'],
  ['/hai-to-diamond/a/b/c', ALL, '/hai-to-diamond'],
];
// 注意: /hai-to-diamond/%2e%2e/1 のような「1つ上の階層へ」の書き方は、送る前に住所そのものが /1 に書き換わる
// （書き換えずに送っても Cloudflare の側で同じ扱いになり 404）。看板のタグも素材も返らない＝安全な側に倒れる。
// 受付係まで届かないので、ここでは確かめない（2026-09-20 に一度ここへ入れて、期待の側の誤りで否が6件出た）
const meta = (html, key) => {
  const m = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
};
let ok = 0, ng = 0;
const check = (name, got, want) => { if (got === want) ok++; else { ng++; console.log('✗', name, '\n   出た', got, '\n   欲しい', want); } };
for (const [path, img, canon] of cases) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  const html = await res.text();
  check(path + ' の応答', res.status, 200);
  check(path + ' og:image', meta(html, 'og:image'), BASE + img);
  check(path + ' twitter:image', meta(html, 'twitter:image'), BASE + img);
  check(path + ' og:url', meta(html, 'og:url'), BASE + canon);
  check(path + ' twitter:card', meta(html, 'twitter:card'), 'summary_large_image');
  check(path + ' 看板のタグが重なっていない', (html.match(/property="og:image"/g) || []).length, 1);
  check(path + ' ページの中身がある', /<div id="root">/.test(html), true);
}
// 42枚が配られているか
const IDS = ['nishida', 'eguchi', 'otsubo', 'sugiyama', 'maeda', 'okamura', 'kiyono', 'kojima', 'hirai', 'kobayashi', 'satoyoshi', 'shimakura', 'takase', 'yamazaki'];
let bytes = 0;
for (const id of IDS) for (const c of [1, 2, 3]) {
  const res = await fetch(`${BASE}/ogp/hai-to-diamond/${id}-${c}.jpg`);
  const buf = new Uint8Array(await res.arrayBuffer());
  bytes += buf.length;
  check(`${id}-${c}.jpg の応答`, res.status, 200);
  check(`${id}-${c}.jpg の種類`, res.headers.get('content-type'), 'image/jpeg');
  check(`${id}-${c}.jpg が本物のJPEG`, buf[0] === 0xff && buf[1] === 0xd8, true);
}
const all = await fetch(BASE + ALL);
check('全員の絵の応答', all.status, 200);
check('全員の絵の種類', all.headers.get('content-type'), 'image/png');
// 外した試し口が出ていない
const stamp = await fetch(BASE + '/ogp/stamp-test?n=1234');
check('外した試し口は絵を返さない', (stamp.headers.get('content-type') || '').startsWith('image/'), false);
console.log(`42枚の合計 ${(bytes / 1024 / 1024).toFixed(2)}MB`);
console.log(`確かめ ${ok + ng}件 ／ 合 ${ok} ／ 否 ${ng}`);
process.exit(ng ? 1 : 0);
