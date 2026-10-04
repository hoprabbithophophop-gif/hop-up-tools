// クロスワードの確かめの台本で共通に使う物。

// 遊ばれた回数を数える呼び出し（/api/crossword-play の touch）を途中で受け止める。本物の回数は増やさない。
// ほかの呼び出しは次の受け止め役か本物の受付係へ回す。onCount は受け止めるたびに呼ぶ
export async function interceptCount(ctx, onCount = () => {}) {
  await ctx.route('**/api/crossword-play', (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.action !== 'touch') return r.fallback();
    onCount();
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"counted":true}' });
  });
}

// 受付係は「字の数×1秒」より速く解けた回をランキングに載せない（2026-10-04）。
// 名前を入れる窓まで確かめる台本は、解き終える前にこれだけ待つ
export const humanWaitMs = (cells) => (cells + 3) * 1000;
