// 受付係（functions/）の守りを、受付係を台本から直接呼んで確かめる（2026-10-26 の2回目のレビューの直し）。
// 本番にもプレビューにも通信しない。棚（Supabase）と人間確認（Turnstile）は作り物が答える（_localFunctions.mjs）。
//
//  1. 答え合わせ（crossword-play の check）は、保存できる最大の問題（60語×30字・1741マス）の答案でも大きさで断らない。
//     check 以外（start など）と、64KB を超える送りは今までどおり 413
//  2. 見えない字（ゼロ幅・向きを変える字・U+3164）だけの題名・カギ・名前・タグは、保存の確かめ（validateSavePayload）で空として扱う。
//     向きを変える字は落としてから棚へ渡す。家族の絵文字のつなぎ（U+200D）は絵文字の間なら残す。isBlankClue もゼロ幅の字と U+3164 だけのカギを空とみなす
//  3. 保存の確かめは、つながっていない語・同じ向きで重なった語・同じ番号と向きのカギ・座標の上限（1741）を超える語を断る。
//     作る画面の組み立て（src/lib/crossword/engine.ts の tryPlaceAll・buildGrid）で作った問題と、作る画面の決まりで作れるいちばん広い階段の形は通る
//  4. 回数の上限（crossword-play の回の始めと遊ばれた回数・crossword-save・crossword-score）は、IPv6 を /64 の帯で丸めて数える
//  5. 問題ページの名札係（functions/crossword/[id].ts）は棚が返事をしない時 1.5 秒ほどで名札なしの素のページを返す。/crossword/tutorial は棚に問い合わせない。
//     保存の受付係は、人間確認の確かめ先が返事をしない時、数秒で「確認に失敗しました」（403 verification）を返す
//  6. .dev.vars が git の対象外
//
// 使い方: node scripts/verify/crossword/check-server-hardening.mjs（引数なし。外へ通信しない）
import { execFileSync } from 'node:child_process';
import { ROOT } from './_lib.mjs';
import { openFunctions, fakeShelf, callFunction, installHtmlRewriter, FAKE_SUPA } from './_localFunctions.mjs';

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
// 受付係が返事をしないまま止まっても台本は止めない（NG にして先へ進む）
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ timedOut: true }), ms))]);

installHtmlRewriter();
const fns = await openFunctions();
try {
  const save = await fns.load('functions/api/crossword-save.ts');
  const play = await fns.load('functions/api/crossword-play.ts');
  const score = await fns.load('functions/api/crossword-score.ts');
  const page = await fns.load('functions/crossword/[id].ts');
  const clueMod = await fns.load('functions/_shared/crosswordClue.ts');
  const engine = await fns.load('src/lib/crossword/engine.ts');
  const { validateSavePayload } = save;

  const hint = { kind: 'link', url: 'https://example.com/' };
  const KEY = 'k'.repeat(64);
  const payload = (clues, extra = {}) => ({ title: '確かめ', tags: [], key: KEY, ...extra, body: { version: 1, width: 1, height: 1, clues, ...(extra.body ?? {}) } });
  const H = (clueIndex, x, y, s, clue = 'x') => ({ clueIndex, direction: 'horizontal', startX: x, startY: y, clue, answer: Array.from(s), hint });
  const V = (clueIndex, x, y, s, clue = 'y') => ({ clueIndex, direction: 'vertical', startX: x, startY: y, clue, answer: Array.from(s), hint });

  // 作る画面の決まりで作れる、いちばん広い階段の形（30字の横→30字の縦→…を最後の字で1マスずつ交わらせて60語）
  const WORD30 = 'ア' + 'イウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ'.slice(0, 28) + 'ア';
  const staircase = () => {
    const out = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < 60; i++) {
      const horizontal = i % 2 === 0;
      out.push({ clueIndex: i + 1, direction: horizontal ? 'horizontal' : 'vertical', startX: x, startY: y, clue: `カギ${i + 1}`, answer: Array.from(WORD30), hint });
      if (horizontal) x += 29;
      else y += 29;
    }
    return out;
  };

  // ---------------------------------------------------------------- 1. 答え合わせの大きさ
  {
    const clues = staircase();
    const id = 'BigBoard';
    const shelf = fakeShelf();
    shelf.addPuzzle({ id, key: KEY, width: 871, height: 871, clues });
    const cells = {};
    for (const c of clues) c.answer.forEach((ch, k) => { cells[`${c.startX + (c.direction === 'horizontal' ? k : 0)},${c.startY + (c.direction === 'vertical' ? k : 0)}`] = ch; });
    const token = '11111111-2222-4333-8444-555555555555';
    shelf.plays.set(token, { id: token, puzzle_id: id, started_at: new Date(Date.now() - 3600_000).toISOString(), revealed: [], misses: 0, last_wrong: false, checks: 0, solved_at: null, counted: false, too_fast: false, active_ms: 3_000_000, resumed_at: null, seen_at: null });
    const base = shelf.fetch;
    const wrapped = { fetch: async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || 'GET').toUpperCase();
      if (u.pathname.endsWith('/crossword_plays') && method === 'GET') return new Response(JSON.stringify([...shelf.plays.values()].filter((p) => p.id === u.searchParams.get('id').slice(3))), { status: 200 });
      if (u.pathname.endsWith('/crossword_answers') && method === 'GET') return new Response(JSON.stringify([{ answers: clues.map((c) => c.answer) }]), { status: 200 });
      return base(input, init);
    } };
    const body = JSON.stringify({ action: 'check', token, answers: cells, waitedMs: 0 });
    const r = await callFunction(play.onRequestPost, wrapped, { body });
    check(r.status === 200 && r.j?.correct === true, `答え合わせ: ${Object.keys(cells).length}マス（${Buffer.byteLength(body)} バイト）の答案を断らずに丸付けする → ${r.status} ${r.text.slice(0, 60)}`);
    const pad = (action, n) => JSON.stringify({ action, token, pad: 'x'.repeat(n) });
    const ping = await callFunction(play.onRequestPost, wrapped, { body: pad('ping', 9000) });
    check(ping.status === 413, `答え合わせ以外（ping）は今までどおり 8192 バイトを超えたら 413 → ${ping.status}`);
    const start = await callFunction(play.onRequestPost, wrapped, { body: JSON.stringify({ action: 'start', puzzleId: id, pad: 'x'.repeat(9000) }) });
    check(start.status === 413, `回の始め（start）も今までどおり 8192 バイトを超えたら 413（check-limits の (c) と同じ形）→ ${start.status}`);
    const huge = await callFunction(play.onRequestPost, wrapped, { body: pad('check', 70000) });
    check(huge.status === 413, `答え合わせでも 64KB を超える送りは 413 → ${huge.status}`);
  }

  // ---------------------------------------------------------------- 2. 見えない字
  {
    const twoClues = (clue1 = 'ネコの鳴き声', extra = {}) => payload([H(1, 0, 0, 'ネコ', clue1), V(2, 1, 0, 'コイ', 'さかな')], extra);
    const invisibles = { 'U+200B': '\u200B', 'U+200C': '\u200C', 'U+200D': '\u200D', 'U+2060': '\u2060', 'U+FEFF': '\uFEFF', 'U+3164': '\u3164', 'U+202E': '\u202E' };
    for (const [name, ch] of Object.entries(invisibles)) {
      check(validateSavePayload(twoClues(ch + ch)) === null, `見えない字 ${name} だけのカギは断る`);
      check(validateSavePayload(twoClues('ネコ', { title: ch + ' ' + ch })) === null, `見えない字 ${name} だけの題名は断る`);
      check(validateSavePayload(twoClues('ネコ', { tags: [ch] })) === null, `見えない字 ${name} だけのタグは断る`);
      const named = validateSavePayload(twoClues('ネコ', { body: { creatorName: ch + ch } }));
      check(named !== null && named.body.creatorName === undefined, `見えない字 ${name} だけの作った人の名前は「名前なし」として扱う`);
    }
    for (const [name, ch] of Object.entries({ 'U+200B': '\u200B', 'U+200C': '\u200C', 'U+200D': '\u200D', 'U+2060': '\u2060', 'U+FEFF': '\uFEFF', 'U+3164': '\u3164' })) {
      check(clueMod.isBlankClue(`${ch}${ch} →`) === true, `isBlankClue: ${name} と→だけのカギは「書いていない」`);
    }
    check(clueMod.isBlankClue('ネコ\u200B') === false, 'isBlankClue: 普通の字があれば「書いてある」');
    const rtl = validateSavePayload(twoClues('右\u202Eから\u2066左\u200F', { title: '題\u202E名', tags: ['タ\u200Bグ'], body: { creatorName: '\u202Dなまえ' } }));
    check(rtl?.body.clues[0].clue === '右から左', `向きを変える字はカギから落として棚へ渡す → ${JSON.stringify(rtl?.body.clues[0].clue)}`);
    check(rtl?.title === '題名' && rtl?.tags[0] === 'タグ' && rtl?.body.creatorName === 'なまえ', `題名・タグ・作った人の名前からも落とす → ${JSON.stringify([rtl?.title, rtl?.tags, rtl?.body.creatorName])}`);
    const family = '👨\u200D👩\u200D👧の家族';
    const fam = validateSavePayload(twoClues(family));
    check(fam?.body.clues[0].clue === family, '家族の絵文字（絵文字の間のつなぎ U+200D）はカギに残す');
    check(validateSavePayload(twoClues('○○○はユーカリを食べる')) !== null, '普通のカギは今までどおり通る');
  }

  // ---------------------------------------------------------------- 3. 盤の形
  {
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')])) !== null, '形: 交わった2語は通る');
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), H(2, 0, 5, 'イヌ')])) === null, '形: つながっていない2語は断る');
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ'), H(3, 10, 10, 'ウマ'), V(4, 10, 10, 'ウシ')])) === null, '形: 2つの島に分かれた4語は断る');
    check(validateSavePayload(payload([H(1, 1_000_000, 0, 'ネコ'), V(2, 1_000_001, 0, 'コイ')])) === null, '形: 100万マス離れた所に置いた語は断る');
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ'), H(3, 0, 0, 'ネコ')])) === null, '形: 同じ場所に同じ向きで2回置いた語は断る');
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ'), H(3, 1, 0, 'コア')])) === null, '形: 同じ向きで1マスでも重なった語は断る');
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ'), H(1, 1, 1, 'イス')])) === null, '形: 同じ番号・同じ向きのカギが2つある問題は断る');
    check(validateSavePayload(payload([H(1, 0, 0, 'ネコ'), V(1, 0, 0, 'ネギ')])) !== null, '形: 同じ番号でも向きが違えば通る（1の横と1の縦）');
    const stairs = staircase();
    const big = validateSavePayload(payload(stairs));
    check(big !== null && big.body.width === 871 && big.body.height === 871, `形: 60語×30字の階段（盤 ${big?.body.width}×${big?.body.height}・座標の最大 870）は通る`);
    // 階段の形が作る画面の決まりで作れること（1語ずつ、組み立てと同じ validatePlacement と isConnected を通る）
    const items = stairs.map((c, i) => ({ id: String(i), uuid: String(i), question: c.clue, answer: c.answer, direction: c.direction, startX: c.startX, startY: c.startY, length: c.answer.length }));
    const okSteps = items.every((it, i) => i === 0 || engine.validatePlacement(it, items.slice(0, i)));
    check(okSteps && engine.isConnected(items), '形: その階段は作る画面の置き方の決まり（validatePlacement・isConnected）で作れる形');
    // 作る画面の組み立てで作った問題が断られない（でたらめに並べて200回）
    const WORDS = ['モーニングムスメ', 'アンジュルム', 'ジュースジュース', 'ツバキファクトリー', 'ビヨンズ', 'オチャノリ', 'ロージークロニクル', 'ハロープロジェクト', 'コンサート', 'ライブ', 'シングル', 'アルバム', 'ステージ', 'ダンス', 'マイク', 'ファン', 'リハーサル', 'ツアー', 'ペンライト', 'アンコール'];
    let tried = 0;
    let rejected = 0;
    let firstBad = '';
    for (let n = 0; n < 200; n++) {
      const pick = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 2 + (n % 19));
      const placed = engine.tryPlaceAll(engine.shuffleByLength(pick.map((w, i) => ({ id: String(i), question: `カギ${i}`, answer: Array.from(w) }))), true, []);
      if (placed.length < 2) continue;
      const g = engine.buildGrid(placed);
      const body = { version: 1, width: g.width, height: g.height, clues: g.items.map((p) => ({ clueIndex: p.clueIndex ?? 0, direction: p.direction, startX: p.startX, startY: p.startY, clue: p.question, answer: p.answer, hint })) };
      tried++;
      if (validateSavePayload({ title: '確かめ', tags: [], key: KEY, body }) === null) {
        rejected++;
        if (!firstBad) firstBad = JSON.stringify(body.clues.map((c) => [c.clueIndex, c.direction, c.startX, c.startY, c.answer.join('')]));
      }
    }
    check(tried > 100 && rejected === 0, `形: 作る画面の組み立て（tryPlaceAll・buildGrid）で作った ${tried} 問はどれも断られない${firstBad ? `（断られた例 ${firstBad}）` : ''}`);
  }

  // ---------------------------------------------------------------- 4. IPv6 は /64 の帯で数える
  {
    const A = '2001:db8:1:2::aaaa';
    const B = '2001:db8:1:2:ffff:1:2:3';
    const C = '2001:db8:1:3::aaaa';
    const id = 'IpPuzzle';
    const token = '21111111-2222-4333-8444-555555555555';
    const run = async (ip, what) => {
      const shelf = fakeShelf();
      shelf.addPuzzle({ id, key: KEY, width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')] });
      shelf.plays.set(token, { id: token, puzzle_id: id, started_at: new Date().toISOString(), revealed: [], misses: 0, last_wrong: false, checks: 0, solved_at: null, counted: false, too_fast: false, active_ms: 0, resumed_at: null, seen_at: null });
      const seen = [];
      const wrapped = { fetch: async (input, init = {}) => {
        const u = new URL(typeof input === 'string' ? input : input.url);
        const method = (init.method || 'GET').toUpperCase();
        if (u.hostname === 'challenges.cloudflare.com') return new Response(JSON.stringify({ success: true }), { status: 200 });
        if (u.pathname.endsWith('/rate_limit_log') && method === 'GET') { seen.push(u.searchParams.get('ip_hash')); return new Response('[]', { status: 200 }); }
        if (u.pathname.endsWith('/rate_limit_log')) return new Response(null, { status: 201 });
        if (u.pathname.endsWith('/crossword_plays') && method === 'GET') return new Response(JSON.stringify([shelf.plays.get(token)]), { status: 200 });
        if (u.pathname.endsWith('/crossword_plays') && method === 'POST') return new Response(JSON.stringify([{ id: token, started_at: new Date().toISOString() }]), { status: 201 });
        if (u.pathname.endsWith('/crossword_plays') && method === 'DELETE') return new Response(null, { status: 204 });
        if (u.pathname.endsWith('/crossword_answers')) return new Response(JSON.stringify([{ answers: [['ネ', 'コ'], ['コ', 'イ']] }]), { status: 200 });
        if (u.pathname.endsWith('/crossword_play_counts') && method === 'POST') { seen.push(JSON.parse(init.body).ip_hash); return new Response('[]', { status: 201 }); }
        if (u.pathname.endsWith('/crossword_play_counts')) return new Response(null, { status: 204 });
        return shelf.fetch(input, init);
      } };
      const headers = { 'CF-Connecting-IP': ip };
      if (what === 'start') await callFunction(play.onRequestPost, wrapped, { headers, body: { action: 'start', puzzleId: id } });
      if (what === 'touch') await callFunction(play.onRequestPost, wrapped, { headers, body: { action: 'touch', token } });
      if (what === 'save') await callFunction(save.onRequestPost, wrapped, { headers, body: { token: 't', puzzle: payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')]) } });
      if (what === 'score') await callFunction(score.onRequestPost, wrapped, { headers, body: { playToken: token, playerKey: 'a'.repeat(64), name: '' } });
      return seen[0];
    };
    for (const [what, label] of [['start', 'crossword-play の回の始め'], ['touch', 'crossword-play の遊ばれた回数（24時間1回）'], ['save', 'crossword-save の保存'], ['score', 'crossword-score のランキング']]) {
      const a = await run(A, what);
      const b = await run(B, what);
      const c = await run(C, what);
      check(!!a && a === b, `${label}: 同じ /64 の帯の別のアドレスは同じ接続元として数える（${a?.slice(0, 8)} / ${b?.slice(0, 8)}）`);
      check(!!a && a !== c, `${label}: 別の帯は別の接続元のまま`);
    }
  }

  // ---------------------------------------------------------------- 5. 返事をしない時の上限
  {
    const hang = (match) => {
      const calls = [];
      return { calls, fetch: (input, init = {}) => {
        const u = new URL(typeof input === 'string' ? input : input.url);
        calls.push(u.href);
        if (!match(u)) return Promise.resolve(new Response('[]', { status: 200 }));
        return new Promise((_, reject) => {
          const sig = init.signal;
          if (sig) sig.addEventListener('abort', () => reject(sig.reason ?? new Error('aborted')));
        });
      } };
    };
    const assets = { fetch: async () => new Response('<!doctype html><html><head><title>t</title></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) };
    const get = (shelf, id) => callFunction(page.onRequest, shelf, { path: `/crossword/${id}`, method: 'GET', params: { id }, assets });

    const stuck = hang((u) => u.origin === FAKE_SUPA && u.pathname.includes('/rest/v1/'));
    let t0 = Date.now();
    let r = await within(get(stuck, 'Abcdefgh'), 6000);
    let ms = Date.now() - t0;
    check(!r.timedOut && r.status === 200 && !/og:title/.test(r.text) && /<title>t<\/title>/.test(r.text), `名札係: 棚が返事をしない時、${ms}ms で名札なしの素のページを返す（上限 1.5 秒）`);
    check(ms < 2500, `名札係: 待つのは 2.5 秒未満 → ${ms}ms`);

    const stuckImg = hang((u) => u.pathname.startsWith('/storage/'));
    const shelf2 = fakeShelf();
    shelf2.addPuzzle({ id: 'Abcdefgh', key: KEY, title: '画像待ち', width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')] });
    const imgWrapped = { fetch: (input, init = {}) => (new URL(typeof input === 'string' ? input : input.url).pathname.startsWith('/storage/') ? stuckImg.fetch(input, init) : shelf2.fetch(input, init)) };
    t0 = Date.now();
    r = await within(get(imgWrapped, 'Abcdefgh'), 6000);
    ms = Date.now() - t0;
    check(!r.timedOut && r.status === 200 && ms < 2500, `名札係: 画像の確かめ先が返事をしない時も ${ms}ms で返す（棚の問い合わせと合わせて 1.5 秒）`);

    const counter = hang(() => false);
    r = await within(get(counter, 'tutorial'), 6000);
    check(!r.timedOut && r.status === 200 && counter.calls.length === 0, `名札係: /crossword/tutorial は棚に問い合わせない（問い合わせ ${counter.calls.length} 本）`);

    const shelf3 = fakeShelf();
    shelf3.addPuzzle({ id: 'LocalImg', key: KEY, title: '普通の問題', width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')] });
    shelf3.images.add('LocalImg');
    r = await get(shelf3, 'LocalImg');
    check(/og:title" content="普通の問題"/.test(r.text) && /og:image/.test(r.text), '名札係: 棚が返事をする時は今までどおり題名と画像の名札が付く');

    const stuckTs = hang((u) => u.hostname === 'challenges.cloudflare.com');
    t0 = Date.now();
    r = await within(callFunction(save.onRequestPost, stuckTs, { body: { token: 't', puzzle: payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')]) } }), 12000);
    ms = Date.now() - t0;
    check(!r.timedOut && r.status === 403 && r.j?.reason === 'verification', `保存: 人間確認の確かめ先が返事をしない時、${ms}ms で 403 verification（確認に失敗しました と同じ断り方）`);
    check(ms < 8000, `保存: 待つのは数秒（8 秒未満）→ ${ms}ms`);
  }
} finally {
  await fns.close();
}

// ---------------------------------------------------------------- 6. .dev.vars
{
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', '.dev.vars'], { cwd: ROOT });
    ignored = true;
  } catch { /* 対象外でない時は終了コード 1 */ }
  check(ignored, '.dev.vars は git の対象外');
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
