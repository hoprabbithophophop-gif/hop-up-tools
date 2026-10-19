// 受付係（functions/ の .ts）を手元で動かすための共通部品。本番にもプレビューにも通信しない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
// vite に .ts を読み込ませ、onRequest / onRequestPost を直接呼ぶ。棚（Supabase）への通信は作り物の棚が受け、外への通信は止める。
// 作り物の棚は、受付係が使う棚の係（rpc）を、棚の決まり（supabase/migrations/）と同じ考え方で真似る。真似ているのは台本が使う分だけ。
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { ROOT } from './_lib.mjs';

export const FAKE_SUPA = 'https://fake-supabase.invalid';
export const FAKE_ENV = {
  VITE_SUPABASE_URL: FAKE_SUPA,
  VITE_SUPABASE_ANON_KEY: 'fake-anon',
  SUPABASE_SECRET_KEY: 'fake-secret',
  TURNSTILE_SECRET: 'fake-turnstile',
};

// vite の読み込み口。使い終わったら close()
export async function openFunctions() {
  const vite = await createServer({
    root: ROOT,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return { load: (rel) => vite.ssrLoadModule(`/${rel}`), close: () => vite.close() };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const json = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 作り物の棚。addPuzzle で問題を置き、fetch を globalThis.fetch に差し込んで使う
export function fakeShelf() {
  const puzzles = new Map(); // id → 行（body は棚に置く形＝答えの代わりに length）
  const keys = new Map(); // id → 合言葉の sha256
  const answers = new Map(); // id → 答え（語ごとの字の配列）
  const images = new Set(); // シェア画像が置かれている問題の番号
  const outside = []; // 止めた外への通信

  const ownerOk = (id, key) => typeof key === 'string' && key.length >= 32 && key.length <= 128 && keys.get(id) === sha256(key);
  const pick = (row, select) => (select ? Object.fromEntries(select.split(',').map((c) => [c, row[c]])) : { ...row });

  async function fetchFake(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    if (url.origin !== FAKE_SUPA) {
      outside.push(`${method} ${url.href}`);
      throw new Error(`外への通信を止めた: ${url.href}`);
    }
    // シェア画像の置き場（HEAD で有無を見る）
    if (url.pathname.startsWith('/storage/')) {
      const id = (url.pathname.match(/([A-Za-z0-9_-]{8})\.png$/) || [])[1];
      return new Response(null, { status: id && images.has(id) ? 200 : 404 });
    }
    const name = url.pathname.replace(/^\/rest\/v1\//, '');
    const eqId = (url.searchParams.get('id') || '').replace(/^eq\./, '');
    switch (name) {
      case 'rate_limit_log':
        return method === 'GET' ? json([]) : new Response(null, { status: 201 });
      case 'rpc/crossword_owner_read':
        return json(ownerOk(body.p_id, body.p_key) ? answers.get(body.p_id) ?? null : null);
      case 'rpc/crossword_update': {
        // 合言葉が合い・隠れておらず・遊ばれた回数 0 の時だけ書き換える（20261005092713_crossword_owner_edit と同じ考え方）
        const row = puzzles.get(body.p_id);
        if (!row || !ownerOk(body.p_id, body.p_key) || row.is_hidden || row.play_count !== 0) return json(false);
        Object.assign(row, { body: body.p_body, title: body.p_title, genre: body.p_genre, tags: body.p_tags, is_beginner: body.p_is_beginner, group_tags: body.p_group_tags });
        answers.set(body.p_id, body.p_answers);
        return json(true);
      }
      case 'rpc/crossword_update_hints': {
        const row = puzzles.get(body.p_id);
        if (!row || !ownerOk(body.p_id, body.p_key) || row.is_hidden) return json(false);
        row.body = body.p_body;
        return json(true);
      }
      case 'crossword_puzzles': {
        if (method !== 'GET') return json({ message: `作り物の棚は crossword_puzzles の ${method} を真似ていない` }, 500);
        const rows = [...puzzles.values()].filter((r) => !eqId || r.id === eqId).filter((r) => !(init.headers?.apikey === FAKE_ENV.VITE_SUPABASE_ANON_KEY && r.is_hidden));
        return json(rows.map((r) => pick(r, url.searchParams.get('select'))));
      }
      default:
        return json({ message: `作り物の棚は ${name} を真似ていない` }, 500);
    }
  }

  return {
    fetch: fetchFake,
    outside,
    puzzles,
    images,
    // 問題を置く。clues は答えつき（answer）で渡す。棚には length に直して置く
    addPuzzle({ id, key, title = '確かめ用', genre = 'other', tags = [], is_beginner = false, group_tags = [], play_count = 0, is_hidden = false, width, height, clues, creatorName }) {
      puzzles.set(id, {
        id, title, genre, tags, is_beginner, group_tags, play_count, is_hidden,
        body: { version: 1, width, height, ...(creatorName ? { creatorName } : {}), clues: clues.map(({ answer, ...c }) => ({ ...c, length: answer.length })) },
      });
      keys.set(id, sha256(key));
      answers.set(id, clues.map((c) => c.answer));
    },
  };
}

// 受付係を1回呼ぶ。fetch を作り物の棚に差し替えて呼び、終わったら戻す。waitUntil に渡された物も待つ
export async function callFunction(handler, shelf, { path = '/', method = 'POST', body, headers = {}, params = {}, env = FAKE_ENV, assets } = {}) {
  const realFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = shelf.fetch;
  try {
    const request = new Request(`https://local.invalid${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const res = await handler({ request, env: assets ? { ...env, ASSETS: assets } : env, params, waitUntil: (p) => pending.push(p) });
    await Promise.allSettled(pending);
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* JSON でない返事（HTML など） */ }
    return { status: res.status, j, text };
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Cloudflare の HTMLRewriter の、台本が使う分だけの真似（<head> の終わりに足す）
export function installHtmlRewriter() {
  globalThis.HTMLRewriter = class {
    constructor() { this.handlers = []; }
    on(selector, handler) { this.handlers.push({ selector, handler }); return this; }
    // 本物は Response をすぐ返すが、受付係は async の中で return するだけなので Promise を返しても同じに動く
    async transform(res) {
      let html = await res.text();
      for (const { selector, handler } of this.handlers) {
        if (selector !== 'head') continue;
        handler.element({ append: (c) => { html = html.replace('</head>', `${c}</head>`); } });
      }
      return new Response(html, { status: res.status, headers: res.headers });
    }
  };
}
