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

  // 7〜9 で使う、作り物の棚の上乗せ。連投の記録（rate_limit_log）と回数の印（crossword_play_counts）を本当に覚える
  // （共通の作り物の棚は rate_limit_log をいつも空で返し、crossword_play_counts を真似ていないため、ここだけで真似る）
  const memoryShelf = (shelf, answersOf = {}) => {
    const log = []; // { ip_hash, endpoint, created_at }
    const counts = []; // { puzzle_id, ip_hash, created_at }
    let added = 0;
    const inList = (cond) => (cond.startsWith('in.(') ? cond.slice(4, -1).split(',') : cond.startsWith('eq.') ? [cond.slice(3)] : null);
    const fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || 'GET').toUpperCase();
      const q = u.searchParams;
      const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
      if (u.hostname === 'challenges.cloudflare.com') return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.pathname.endsWith('/rate_limit_log')) {
        if (method === 'POST') { log.push({ ...body, created_at: new Date().toISOString() }); return new Response(null, { status: 201 }); }
        if (method === 'GET') {
          const since = Date.parse(q.get('created_at').slice(3));
          const rows = log.filter((r) => r.endpoint === q.get('endpoint').slice(3) && r.ip_hash === q.get('ip_hash').slice(3) && Date.parse(r.created_at) > since);
          return new Response(JSON.stringify(rows.slice(0, Number(q.get('limit') || 1e9)).map(() => ({ id: 1 }))), { status: 200 });
        }
        return new Response(null, { status: 204 });
      }
      if (u.pathname.endsWith('/crossword_play_counts')) {
        const hashes = q.get('ip_hash') ? inList(q.get('ip_hash')) : null;
        const pid = q.get('puzzle_id')?.slice(3);
        const hit = (r) => (!pid || r.puzzle_id === pid) && (!hashes || hashes.includes(r.ip_hash)) && (!q.get('created_at') || Date.parse(r.created_at) < Date.parse(q.get('created_at').slice(3)));
        if (method === 'POST') {
          if (counts.some((r) => r.puzzle_id === body.puzzle_id && r.ip_hash === body.ip_hash)) return new Response('[]', { status: 201 });
          const row = { ...body, created_at: new Date().toISOString() };
          counts.push(row);
          return new Response(JSON.stringify([row]), { status: 201 });
        }
        if (method === 'GET') return new Response(JSON.stringify(counts.filter(hit).map((r) => ({ ip_hash: r.ip_hash }))), { status: 200 });
        if (method === 'DELETE') { for (let i = counts.length - 1; i >= 0; i--) if (hit(counts[i])) counts.splice(i, 1); return new Response(null, { status: 204 }); }
      }
      if (u.pathname.endsWith('/rpc/crossword_add_play')) { added++; return new Response('null', { status: 200 }); }
      if (u.pathname.endsWith('/crossword_plays') && method === 'GET') return new Response(JSON.stringify([shelf.plays.get(q.get('id').slice(3))].filter(Boolean)), { status: 200 });
      if (u.pathname.endsWith('/crossword_answers')) return new Response(JSON.stringify([{ answers: answersOf[q.get('puzzle_id').slice(3)] }]), { status: 200 });
      return shelf.fetch(input, init);
    };
    return { fetch, log, counts, added: () => added };
  };
  let tokenSeq = 0;
  const newToken = () => `${String(++tokenSeq).padStart(8, '0')}-2222-4333-8444-555555555555`;

  // ---------------------------------------------------------------- 7. ランキング: 同じ家・同じ問題の連投だけを止める
  {
    const shelf = fakeShelf();
    const twoWords = [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')];
    shelf.addPuzzle({ id: 'ScoreAAA', key: KEY, width: 2, height: 2, clues: twoWords });
    shelf.addPuzzle({ id: 'ScoreBBB', key: KEY, width: 2, height: 2, clues: twoWords });
    const mem = memoryShelf(shelf);
    const send = async (puzzle, { ip = '203.0.113.7', ms = 60_000, player = 'a'.repeat(64) } = {}) => {
      const token = newToken();
      shelf.addPlay({ id: token, puzzle_id: puzzle, active_ms: ms });
      const r = await callFunction(score.onRequestPost, mem, { headers: { 'CF-Connecting-IP': ip }, body: { playToken: token, playerKey: player, name: '' } });
      return { ...r, token };
    };
    // 1人が解き直して速くなっていく（練習した人の記録は書き換わる）＋家族が1回ずつ。同じ家・同じ問題で5回まで
    const first = [];
    for (let i = 0; i < 5; i++) first.push(await send('ScoreAAA', { ms: 60_000 - i * 5000, player: (i < 3 ? 'a' : String(i)).repeat(64) }));
    check(first.every((r) => r.status === 200 && r.j?.ok === true), `ランキング: 同じ家・同じ問題から1時間に5回までは載せる → ${first.map((r) => r.status).join(',')}`);
    const best = shelf.scores.find((s) => s.puzzle_id === 'ScoreAAA' && s.time_seconds === 50);
    check(!!best, `ランキング: 解き直して速くなった記録は今までどおり書き換わる（3回目の50秒が残る）→ ${shelf.scores.filter((s) => s.puzzle_id === 'ScoreAAA').map((s) => s.time_seconds).join(',')}`);
    const sixth = await send('ScoreAAA', { ms: 10_000, player: 'f'.repeat(64) });
    check(sixth.status === 429 && sixth.j?.reason === 'score_limit', `ランキング: 6回目は載せない（429 score_limit）→ ${sixth.status} ${sixth.text.slice(0, 60)}`);
    check(!shelf.scores.some((s) => s.time_seconds === 10), 'ランキング: 6回目の記録は棚に入っていない');
    check(shelf.plays.get(sixth.token).scored === false, 'ランキング: 載せなかった回の「記録済み」の印は外す（1時間たてば送り直せる）');
    const other = await send('ScoreBBB');
    check(other.status === 200 && other.j?.ok === true, `ランキング: 同じ家でも別の問題は載せる → ${other.status}`);
    const neighbor = await send('ScoreAAA', { ip: '198.51.100.9', player: 'b'.repeat(64) });
    check(neighbor.status === 200 && neighbor.j?.ok === true, `ランキング: 別の家からの同じ問題は載せる → ${neighbor.status}`);
    const v6a = await send('ScoreBBB', { ip: '2001:db8:9:9::1' });
    for (let i = 0; i < 4; i++) await send('ScoreBBB', { ip: `2001:db8:9:9::${i + 2}` });
    const v6b = await send('ScoreBBB', { ip: '2001:db8:9:9:ffff::1' });
    check(v6a.status === 200 && v6b.status === 429 && v6b.j?.reason === 'score_limit', `ランキング: IPv6 は同じ /64 の帯を同じ家として数える → ${v6a.status} / ${v6b.status}`);
    // 1時間より前の送りは数えない（記録の時刻を1時間より前にずらす）
    for (const r of mem.log) r.created_at = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    const later = await send('ScoreAAA', { ms: 9_000, player: 'f'.repeat(64) });
    check(later.status === 200 && later.j?.ok === true, `ランキング: 1時間たてば同じ家・同じ問題からまた載せる → ${later.status}`);
  }

  // ---------------------------------------------------------------- 8. 作った人の名前のなりすまし
  {
    const update = await fns.load('functions/api/crossword-update.ts');
    const named = (creatorName, extra = {}) => payload([H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')], { ...extra, body: { creatorName } });
    const bad = ['公式', 'ハロプロ公式', '運営', '運営より', 'hop-up-tools', 'HOP-UP TOOLS', 'Hop Up Tools', 'ｈｏｐ－ｕｐ　ｔｏｏｌｓ', 'HOP_UP_TOOLS', 'hopuptools中の人', 'スタッフ', 'ｽﾀｯﾌ', 'スタッフA', '公​式',
      '牧野真莉愛', '牧野 真莉愛', '牧野　真莉愛', ' 牧野真莉愛 ', '山﨑愛生', '西﨑美空', '松原 ユリヤ'];
    for (const n of bad) check(validateSavePayload(named(n)) === null, `名前: 「${n}」は保存の確かめで断る`);
    const good = ['ほっぷ', '牧野', '真莉愛', '牧野真莉愛ファン', 'まりあ推し', 'hop_rabbit', 'つばきファン'];
    for (const n of good) check(validateSavePayload(named(n))?.body.creatorName === n, `名前: 「${n}」は通す`);
    check(validateSavePayload(named('ほっぷ', { title: '【公式】ハロプロクイズ' }))?.title === '【公式】ハロプロクイズ', '名前: 題名の【公式】は止めない');

    const shelf = fakeShelf();
    const mem = memoryShelf(shelf);
    const r = await callFunction(save.onRequestPost, mem, { body: { token: 't', puzzle: named('HOP-UP TOOLS運営') } });
    check(r.status === 400 && r.j?.reason === 'bad_name', `名前: 保存の受付係は理由 bad_name で断る → ${r.status} ${r.text.slice(0, 60)}`);
    const r2 = await callFunction(save.onRequestPost, mem, { body: { token: 't', puzzle: payload([H(1, 0, 0, 'ネコ')], { body: { creatorName: 'ほっぷ' } }) } });
    check(r2.status === 400 && r2.j?.reason === 'bad_request', `名前: 名前以外の形の誤りは今までどおり bad_request → ${r2.status} ${r2.j?.reason}`);

    shelf.addPuzzle({ id: 'UpdName1', key: KEY, width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')] });
    const u1 = await callFunction(update.onRequestPost, mem, { body: { id: 'UpdName1', key: KEY, puzzle: named('牧野　真莉愛') } });
    check(u1.status === 400 && u1.j?.reason === 'bad_name', `名前: 組み直し（crossword-update）も理由 bad_name で断る → ${u1.status} ${u1.text.slice(0, 60)}`);
    const u2 = await callFunction(update.onRequestPost, mem, { body: { id: 'UpdName1', key: KEY, puzzle: named('ほっぷ') } });
    check(u2.status === 200 && u2.j?.ok === true, `名前: 組み直しで普通の名前は通る → ${u2.status} ${u2.text.slice(0, 60)}`);
    // 決まりより前に「公式」を含む名前で公開した人も、名前を変えなければ組み直せる（2026-10-27 時間を大事にする直し）
    shelf.addPuzzle({ id: 'UpdName2', key: KEY, width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')], creatorName: '非公式ファン' });
    const u3 = await callFunction(update.onRequestPost, mem, { body: { id: 'UpdName2', key: KEY, puzzle: named('非公式ファン') } });
    check(u3.status === 200 && u3.j?.ok === true, `名前: 前から公開している名前のままなら組み直せる → ${u3.status} ${u3.text.slice(0, 60)}`);
    shelf.addPuzzle({ id: 'UpdName3', key: KEY, width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')], creatorName: '非公式ファン' });
    const u4 = await callFunction(update.onRequestPost, mem, { body: { id: 'UpdName3', key: KEY, puzzle: named('公式') } });
    check(u4.status === 400 && u4.j?.reason === 'bad_name', `名前: 名前を別のなりすましに変える組み直しは断る → ${u4.status} ${u4.j?.reason}`);
    const u5 = await callFunction(update.onRequestPost, mem, { body: { id: 'UpdName1', key: 'z'.repeat(64), puzzle: named('ほっぷ') } });
    check(u5.status === 404, `名前: 合言葉が違えば名前を見る前に断る（他人の問題の名前は確かめられない）→ ${u5.status}`);
  }

  // ---------------------------------------------------------------- 9. 遊ばれた回数は端末ごとに数える（同じ家・同じ問題で24時間に5台まで）
  {
    const shelf = fakeShelf();
    const answersOf = {};
    for (const id of ['CountAAA', 'CountBBB', 'CountCCC']) {
      shelf.addPuzzle({ id, key: KEY, width: 2, height: 2, clues: [H(1, 0, 0, 'ネコ'), V(2, 1, 0, 'コイ')] });
      answersOf[id] = [['ネ', 'コ'], ['コ', 'イ']];
    }
    const mem = memoryShelf(shelf, answersOf);
    const touch = async (puzzle, deviceId, ip = '203.0.113.7') => {
      const token = newToken();
      shelf.plays.set(token, { id: token, puzzle_id: puzzle, started_at: new Date().toISOString(), revealed: [], misses: 0, last_wrong: false, checks: 0, solved_at: null, counted: false, too_fast: false, active_ms: 0, resumed_at: null, seen_at: null });
      const r = await callFunction(play.onRequestPost, mem, { headers: { 'CF-Connecting-IP': ip }, body: { action: 'touch', token, ...(deviceId === undefined ? {} : { deviceId }) } });
      return r.j?.counted === true;
    };
    const dev = (n) => n.toString(16).padStart(64, '0');
    const fam = [];
    for (let i = 1; i <= 5; i++) fam.push(await touch('CountAAA', dev(i)));
    check(fam.every(Boolean), `回数: 同じ家の別々の端末5台はそれぞれ数える → ${fam.join(',')}（足した回数 ${mem.added()}）`);
    check((await touch('CountAAA', dev(1))) === false, '回数: 同じ端末・同じ問題は24時間に1回だけ');
    check((await touch('CountAAA', dev(6))) === false, '回数: 同じ家・同じ問題の6台目（番号を変えた数え直し）は数えない');
    check((await touch('CountAAA', dev(7), '198.51.100.9')) === true, '回数: 別の家の端末は数える');
    check((await touch('CountBBB', dev(1))) === true, '回数: 同じ端末でも別の問題は数える');
    check((await touch('CountAAA', dev(8), '2001:db8:5:5::1')) === true && (await touch('CountAAA', dev(8), '2001:db8:5:5::2')) === false, '回数: IPv6 は同じ /64 の帯の同じ端末を1台として数える');
    // 番号が無い（古い画面）・形が違う時は、今までどおり家の帯だけで24時間に1回
    check((await touch('CountCCC')) === true, '回数: 番号が無い時は家の帯で1回数える');
    check((await touch('CountCCC')) === false, '回数: 番号が無い時、同じ家・同じ問題の2回目は数えない（今までどおり）');
    check((await touch('CountCCC', 'xyz')) === false, '回数: 形の違う番号は「番号なし」として扱う（家の帯で数え済み）');
    // 24時間たてば席が空き、6台目も数える（印の時刻を24時間より前にずらす）
    for (const r of mem.counts) r.created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    check((await touch('CountAAA', dev(6))) === true, '回数: 24時間たてば、前に数えなかった6台目も数える');
    check((await touch('CountAAA', dev(1))) === true, '回数: 24時間たてば、同じ端末をまた数える');
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
