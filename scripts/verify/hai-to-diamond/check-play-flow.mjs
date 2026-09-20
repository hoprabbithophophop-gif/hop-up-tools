// 灰toダイヤモンドを「実際に遊んで」確かめる台本。ブラウザは1回だけ立て、
// 端末の覚え書きが違う状態（初めての人・控えがある人など）は newContext() を替えて作る。
//
// 使い方: `node scripts/verify/hai-to-diamond/check-play-flow.mjs [住所]`
//         （省略時はプレビュー https://feature-hai-to-diamond.hop-up-tools.pages.dev ）
// スクリーンショットの置き場は環境変数 VERIFY_OUT があればそこ、無ければ端末の一時置き場の下。
//
// 大事な決まり:
//  - 開く住所には必ず `?qa=1` を付ける（確かめ用の送信止め・紙29行目）。付けずに曲を通すと
//    本番の歴代累計とみんなの💎の記録を汚すので、住所を組み立てる関数を1つにして必ず付ける。
//  - 曲を通す道の最初に、画面の左上の「QA」の印を確かめる。出ていなければ再生を始めずにその道を否で打ち切る。
//  - 台本自身も見張る: GET 以外で YouTube・Google 以外へ行く要求が1件でもあれば否。
//  - 判定は 合／否／未再現 の3つ。環境のせいで見られない物（コメントが1件も取れない・動画が始まらない）は
//    否ではなく未再現にする。終了の番号は、否が1つでもあれば 1、否が無ければ 0（未再現があっても 0）。
//  - 人の名前は書かない。メンバーは id（nishida・eguchi・kiyono など）で指す。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = (process.argv[2] || 'https://feature-hai-to-diamond.hop-up-tools.pages.dev').replace(/\/+$/, '');
const OUT = path.join(process.env.VERIFY_OUT || path.join(os.tmpdir(), 'hai-to-diamond-verify'), 'play-flow');
mkdirSync(OUT, { recursive: true });

/** 住所の組み立ては必ずここを通す。確かめ用の送信止め `?qa=1` を1か所で付ける（紙29行目） */
function url(p = '/hai-to-diamond') {
  const u = new URL(BASE + p);
  u.searchParams.set('qa', '1');
  return u.toString();
}

/** 覚え書き（記録した項目）。判定は 合／否／未再現 */
const items = [];
const add = (name, paper, verdict, want, got) => { items.push({ 項目: name, 紙: paper, 判定: verdict, 期待: want, 実際: got }); };
/** 期待と実際を突き合わせて記録する。真なら合・偽なら否 */
const check = (name, paper, ok, want, got) => add(name, paper, ok ? '合' : '否', want, got);

/** GET 以外で行ってよい先。ここ以外への非GETが1件でもあれば否（紙29行目）。
 *  住所の中の文字で見ると、YouTube の要求が引数に自分の住所を抱えていて誤って拾うので、必ず宿主の名前で見る。
 *  cloudflareinsights.com は index.html に入っている Cloudflare の人数かぞえ（全ページ共通）で、
 *  この台本の「1度も押さない道」でも同じだけ出る＝遊んだ記録とは関係ない。
 *  自分の記録の送り先（このサイト自身の受け口・supabase）は、ここに入れない */
const ALLOW_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'ytimg.com', 'googlevideo.com', 'google.com', 'googleapis.com', 'gstatic.com', 'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'cloudflareinsights.com'];
const offending = [];
function watchRequests(ctx, where) {
  ctx.on('request', (req) => {
    if (req.method() === 'GET') return;
    let host = '';
    try { host = new URL(req.url()).hostname; } catch { host = '(読めない住所)'; }
    if (ALLOW_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return;
    offending.push(`${where}: ${req.method()} ${req.url().slice(0, 140)}`);
  });
}

/** 入口が出るまで待つ。出なければ null を返す（その道は未再現にする） */
async function openEntry(ctx, p) {
  const page = await ctx.newPage();
  // どの道の、コードのどこで起きたかまで控える（たまにしか出ないつまずきを、出た1回で突き止めるため）
  page.on('pageerror', (e) => errors.push(`[${p}] ${String(e).slice(0, 160)} ｜ ${String(e.stack || '').split('\n').slice(1, 4).map((s) => s.trim()).join(' ← ').slice(0, 300)}`));
  await page.goto(url(p), { waitUntil: 'domcontentloaded' });
  const ok = await page.waitForFunction(() => document.body.innerText.includes('はじまります'), null, { timeout: 120000 }).then(() => true, () => false);
  return ok ? page : (await page.close(), null);
}
const errors = [];

/** YouTube の操作の口へ命令を送る（自動のブラウザでも再生を始められる唯一の道） */
const cmd = (page, func, args = []) => page.evaluate(([f, a]) => {
  document.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: f, args: a }), '*');
}, [func, args]);

/** 曲を通す道の関所。左上の「QA」の印が出ていなければ再生を始めない。
 *  始められたら色えらびが出るまで待つ。戻り値は 'ok' / 'qa無し' / '色えらびが出ない' */
async function startPlay(page, where) {
  const mark = await page.evaluate(() => document.querySelector('[data-testid="diamond-qa-mark"]')?.textContent?.trim() ?? null);
  qaMarks.push(`${where}=${mark ?? 'なし'}`);
  if (mark !== 'QA') return 'qa無し';
  await cmd(page, 'playVideo');
  const shown = await page.waitForSelector('[data-diamond-color-id]', { state: 'visible', timeout: 40000 }).then(() => true, () => false);
  return shown ? 'ok' : '色えらびが出ない';
}
const qaMarks = [];

/** 曲の終わりへ送って終了画面が出るまで待つ */
async function finishSong(page) {
  await cmd(page, 'seekTo', [262, true]);
  return page.waitForFunction(() => document.body.innerText.includes('降らせました'), null, { timeout: 60000 }).then(() => true, () => false);
}

/** 画面の文字を空白抜きで見る（数字の塊は桁ごとの部品なので、素の innerText には改行が挟まる） */
const squashed = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ''));

/** ⚙を開く。動画の位置が測れるまで⚙は効かないので、出なければ1回だけ押し直す */
async function openSettings(page) {
  for (let i = 0; i < 2; i++) {
    await page.click('button[aria-label="表示設定"]').catch(() => {});
    const ok = await page.waitForFunction(() => document.body.innerText.includes('色の並び'), null, { timeout: 6000 }).then(() => true, () => false);
    if (ok) return true;
  }
  return false;
}

/** 「今の色」＝色えらびで押された印が立っている💎の id */
const currentId = (page) => page.evaluate(() => [...document.querySelectorAll('[data-diamond-color-id]')].filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.getAttribute('data-diamond-color-id')).join(','));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--mute-audio'] });
const CTX = { viewport: { width: 390, height: 844 }, hasTouch: true };

try {
  // ───────────────────────────────── A. 通しで遊ぶ（初めての人・素の住所）
  try {
    const ctx = await browser.newContext(CTX);
    watchRequests(ctx, 'A');
    // ハイ！テンションの控えだけ先に置く。こちらで色を替えてもこれが変わらないことを見るため（紙45行目）
    await ctx.addInitScript(() => { try { localStorage.setItem('hi_tension:last_selected_member_id', 'takase'); } catch { /* 使えない端末 */ } });
    const page = await openEntry(ctx, '/hai-to-diamond');
    if (!page) {
      add('A 通しで遊ぶ', '紙9〜46行目', '未再現', '入口が出る', '2分待っても入口が出なかった');
    } else {
      await page.screenshot({ path: path.join(OUT, 'a1-entry.png') });
      const entry = await page.evaluate(() => ({
        text: document.body.innerText,
        gear: !!document.querySelector('button[aria-label="表示設定"]'),
      }));
      const wantEntry = ['灰toダイヤモンド', '#銀河to銀河届けよ', '動画の再生ボタンを押すと はじまります', '歴代累計'];
      const missEntry = wantEntry.filter((w) => !entry.text.includes(w));
      check('入口の見出し・副題・案内・歴代累計', '紙9・10行目', missEntry.length === 0, wantEntry.join(' / '), missEntry.length ? '足りない: ' + missEntry.join(' / ') : 'ぜんぶある');
      check('入口の右上に⚙がある', '紙9行目', entry.gear, 'button[aria-label="表示設定"] がある', entry.gear ? 'ある' : '無い');

      // ⚙の中身（紙9・14行目）
      const opened = await openSettings(page);
      if (!opened) {
        add('⚙の中身', '紙9・14行目', '未再現', '設定の板が開く', '⚙を2回押しても板が開かなかった');
      } else {
        const st = await page.evaluate(() => document.body.innerText);
        const wantSt = ['かるくする', '標準', 'みんなの💎', '動き', '色の並び'];
        const missSt = wantSt.filter((w) => !st.includes(w));
        check('⚙の中身', '紙9・14行目', missSt.length === 0, wantSt.join(' / '), missSt.length ? '足りない: ' + missSt.join(' / ') : 'ぜんぶある');
        await page.click('button[aria-label="表示設定"]').catch(() => {});
        await page.getByText('閉じる', { exact: true }).click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);
      }

      // 再生を始める
      const started = await startPlay(page, 'A');
      if (started !== 'ok') {
        add('A 再生中の確かめ', '紙10〜21行目', started === 'qa無し' ? '否' : '未再現', '「QA」の印が出て、再生すると色えらびが出る', started);
      } else {
        await page.screenshot({ path: path.join(OUT, 'a2-playing.png') });

        // 1ページ目の4つ（紙12行目）
        const gems = await page.evaluate(() => [...document.querySelectorAll('[data-diamond-page="0"] [data-diamond-color-id]')].map((e) => {
          const r = e.getBoundingClientRect();
          return { id: e.getAttribute('data-diamond-color-id'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
        }));
        const wantIds = ['nishida', 'eguchi', 'otsubo', 'sugiyama'];
        check('1ページ目の顔ぶれ', '紙12行目', gems.length === 4 && gems.every((g, i) => g.id === wantIds[i]), wantIds.join(','), gems.map((g) => g.id).join(',') || '1つも見つからない');
        const sameSize = gems.length === 4 && gems.every((g) => g.w === 64 && g.h === 64);
        check('1ページ目の💎は同じ大きさ 64px', '紙12行目', sameSize, 'ぜんぶ 64x64', gems.map((g) => `${g.w}x${g.h}`).join(' '));
        const gaps = gems.slice(1).map((g, i) => g.x - gems[i].x);
        const evenly = gaps.length === 3 && gaps.every((v) => Math.abs(v - gaps[0]) <= 1);
        check('1ページ目の💎は横に等間隔', '紙12行目', evenly, '隣との間隔が同じ', gaps.join(' / ') || '測れない');
        const dots = await page.evaluate(() => {
          const box = document.querySelector('[data-diamond-color-pages]');
          if (!box) return -1;
          const rows = [...box.querySelectorAll(':scope > div[aria-hidden="true"]')];
          const last = rows[rows.length - 1];
          return last ? last.querySelectorAll('span').length : -1;
        });
        check('下の小さな点が4つ', '紙12行目', dots === 4, '4つ', dots < 0 ? '点の並びが見つからない' : `${dots}つ`);

        // 札も控えも無い人の最初の色（紙46行目）。ハイ！テンションの控えは読まない
        const first = await currentId(page);
        check('札も控えも無い人の最初の色', '紙46行目', first === 'nishida', 'nishida', first || '今の色が見つからない');

        // 💎を3回押す（紙10・17行目）
        for (let i = 0; i < 3; i++) { await page.tap('[data-diamond-color-id="eguchi"]'); await page.waitForTimeout(700); }
        await page.waitForTimeout(1200);
        const live = await squashed(page);
        const m = live.match(/あなたの💎(\d+)/);
        check('3回押すと自分の回数が3', '紙10・17行目', m?.[1] === '3', 'あなたの💎 3', m ? `あなたの💎 ${m[1]}` : '自分の回数が読めない');

        // 端末の覚え書き（紙45行目）。ここで読む。あとで開き直すと置き直しに紛れる
        const store = await page.evaluate(() => ({ mine: localStorage.getItem('hai_to_diamond:last_selected_member_id'), hi: localStorage.getItem('hi_tension:last_selected_member_id') }));
        check('色の控えは灰toダイヤモンド専用の名前に入る', '紙45行目', store.mine === 'eguchi', 'hai_to_diamond:last_selected_member_id = eguchi', `= ${store.mine}`);
        check('ハイ！テンションの控えを書き換えない', '紙45行目', store.hi === 'takase', 'hi_tension:last_selected_member_id = takase のまま', `= ${store.hi}`);

        // コメントを1件押す（紙21行目）
        const credit = await page.evaluate(() => document.querySelector('[data-testid="diamond-video-credit"]')?.innerText?.trim() ?? null);
        const tapped = await page.tap('[data-testid="diamond-comment-ticker"] >> nth=0', { timeout: 8000 }).then(() => true, () => false)
          || await page.tap('[data-testid="diamond-comment-ticker"] >> nth=0', { timeout: 5000, force: true }).then(() => true, () => false);
        const panel = tapped ? await page.evaluate(() => document.querySelector('[data-testid="diamond-comment-open"]')?.innerText ?? null) : null;
        if (!panel) {
          add('コメントを押すと全文の板が開く', '紙21行目', '未再現', '全文の板に「YouTube で見る」と「閉じる」', credit ? 'コメントが1件も流れてこなかった（鍵が無いか、まだ届いていない）' : 'コメントの列そのものが出ていない');
        } else {
          const wantP = ['YouTube で見る', '閉じる'];
          const missP = wantP.filter((w) => !panel.includes(w));
          check('コメントを押すと全文の板が開く', '紙21行目', missP.length === 0, wantP.join(' / '), missP.length ? '足りない: ' + missP.join(' / ') : 'ぜんぶある');
        }
        check('コメントの上にチャンネル名と動画タイトルの1行', '紙21行目', Boolean(credit && credit.includes('／')), 'チャンネル名 ／ 動画タイトル', credit ?? 'その1行が出ていない');
        if (panel) await page.locator('[data-testid="diamond-comment-open"]').getByText('閉じる', { exact: true }).click({ timeout: 4000 }).catch(() => {});

        // 曲の終わりへ送る（紙27・38・39行目）
        const ended = await finishSong(page);
        if (!ended) {
          add('A 終了画面', '紙27・38・39行目', '未再現', '曲の終わりで終了画面へ移る', '1分待っても終了画面が出なかった');
        } else {
          await page.screenshot({ path: path.join(OUT, 'a3-end.png') });
          const endText = await page.evaluate(() => document.body.innerText);
          const endSq = endText.replace(/\s+/g, '');
          const cm = endSq.match(/(\d[\d,]*)個降らせました/);
          check('終了画面の「◯個 降らせました」', '紙38行目', cm?.[1] === '3', '3個 降らせました', cm ? `${cm[1]}個 降らせました` : 'その文が見つからない');
          for (const [name, word] of [['YouTubeで開く', 'YouTubeで開く'], ['最初に戻る', '最初に戻る'], ['𝕏 でシェア', 'でシェア']]) {
            check(`終了画面に「${name}」`, '紙39行目', endText.includes(word), word, endText.includes(word) ? 'ある' : '無い');
          }
          const wantNote = ['楽曲・映像の著作権は権利者に帰属します。', 'Gem icon by Font Awesome'];
          const missNote = wantNote.filter((w) => !endText.includes(w));
          check('終了画面の断り書き', '紙27・39行目', missNote.length === 0, wantNote.join(' / '), missNote.length ? '足りない: ' + missNote.join(' / ') : 'ぜんぶある');

          // シェアのリンク（紙27・41行目）。X の投稿画面は開かせず、行き先だけ受け取る
          await page.evaluate(() => { window.__share = null; window.open = (u) => { window.__share = u; return null; }; });
          await page.getByText('でシェア').click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1200);
          const share = await page.evaluate(() => window.__share);
          if (!share) {
            add('シェアのリンク', '紙27・41行目', '未再現', 'X の投稿画面の住所を受け取る', '「𝕏 でシェア」を押しても行き先が取れなかった');
          } else {
            const su = new URL(share);
            const text = su.searchParams.get('text') ?? '';
            check('シェアの行き先は X の投稿画面', '紙41行目', su.origin + su.pathname === 'https://x.com/intent/tweet', 'https://x.com/intent/tweet', su.origin + su.pathname);
            const lines = text.split('\n');
            check('シェアの1行目（押した回数）', '紙27行目', lines[0] === '灰toダイヤモンドに合わせて 💎を 3個 降らせました', '灰toダイヤモンドに合わせて 💎を 3個 降らせました', lines[0] ?? '(空)');
            check('シェアのハッシュタグ', '紙27行目', lines[1] === '#輝きなビヨちゃん', '#輝きなビヨちゃん', lines[1] ?? '(空)');
            const okUrl = /^https:\/\/hop-up-tools\.pages\.dev\/hai-to-diamond\/eguchi\/[123]$/.test(lines[2] ?? '');
            check('シェアの住所（押した色と1〜3の番号）', '紙41行目', okUrl, 'https://hop-up-tools.pages.dev/hai-to-diamond/eguchi/<1〜3>', lines[2] ?? '(空)');
          }

          // 「最初に戻る」→ 入口へ戻る（紙26行目）
          await page.getByText('最初に戻る', { exact: true }).click({ timeout: 8000 }).catch(() => {});
          const back = await page.waitForFunction(() => document.body.innerText.includes('動画の再生ボタンを押すと はじまります'), null, { timeout: 20000 }).then(() => true, () => false);
          check('「最初に戻る」で入口へ戻る', '紙26行目', back, '入口の案内文が出る', back ? '入口へ戻った' : '20秒待っても入口へ戻らなかった');
        }
      }
      await ctx.close();
    }
  } catch (e) { add('A 通しで遊ぶ', '紙9〜46行目', '否', '途中で転ばずに歩けること', String(e).split('\n')[0]); }

  // ───────────────────────────────── B. 1度も押さずに終える
  try {
    const ctx = await browser.newContext(CTX);
    watchRequests(ctx, 'B');
    const page = await openEntry(ctx, '/hai-to-diamond');
    if (!page) {
      add('B 1度も押さずに終える', '紙27・45行目', '未再現', '入口が出る', '2分待っても入口が出なかった');
    } else {
      const started = await startPlay(page, 'B');
      if (started !== 'ok') {
        add('B 1度も押さずに終える', '紙27行目', started === 'qa無し' ? '否' : '未再現', '「QA」の印が出て、再生すると色えらびが出る', started);
      } else if (!(await finishSong(page))) {
        add('B 1度も押さずに終える', '紙27行目', '未再現', '曲の終わりで終了画面へ移る', '1分待っても終了画面が出なかった');
      } else {
        await page.evaluate(() => { window.__share = null; window.open = (u) => { window.__share = u; return null; }; });
        await page.getByText('でシェア').click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const share = await page.evaluate(() => window.__share);
        if (!share) {
          add('1度も押さない時のシェアの1行目', '紙27行目', '未再現', 'X の投稿画面の住所を受け取る', '「𝕏 でシェア」を押しても行き先が取れなかった');
        } else {
          const line = (new URL(share).searchParams.get('text') ?? '').split('\n')[0];
          const want = '下の💎をタップで💎が降ってくる！BEYOOOOONDSに輝いてほしい分だけをキラキラにしましょう！';
          check('1度も押さない時のシェアの1行目', '紙27行目', line === want, want, line || '(空)');
        }
        // 押していない＝色を選んでいないので、ハイ！テンションの控えは作られない（紙45行目）
        const hi = await page.evaluate(() => localStorage.getItem('hi_tension:last_selected_member_id'));
        check('ハイ！テンションの控えを作らない', '紙45行目', hi === null, 'hi_tension:last_selected_member_id は無いまま', hi === null ? '無い' : `= ${hi}`);
      }
      await ctx.close();
    }
  } catch (e) { add('B 1度も押さずに終える', '紙27・45行目', '否', '途中で転ばずに歩けること', String(e).split('\n')[0]); }

  // ───────────────────────────────── C1. 札つきの住所で来た初めての人＋終了画面の数字の色
  try {
    const ctx = await browser.newContext(CTX);
    watchRequests(ctx, 'C1');
    const page = await openEntry(ctx, '/hai-to-diamond/kiyono/2');
    if (!page) {
      add('C1 札つきの住所で来た初めての人', '紙44・46行目', '未再現', '入口が出る', '2分待っても入口が出なかった');
    } else {
      const started = await startPlay(page, 'C1');
      if (started !== 'ok') {
        add('C1 札つきの住所で来た初めての人', '紙44・46行目', started === 'qa無し' ? '否' : '未再現', '「QA」の印が出て、再生すると色えらびが出る', started);
      } else {
        const id = await currentId(page);
        check('札つきの住所で来た初めての人の最初の色', '紙46行目', id === 'kiyono', 'kiyono', id || '今の色が見つからない');
        await page.tap('[data-diamond-color-id="kiyono"]').catch(() => {});
        await page.waitForTimeout(800);
        if (!(await finishSong(page))) {
          add('終了画面の個数の数字の色', '紙44行目', '未再現', '名簿の #fc4c02', '1分待っても終了画面が出なかった');
        } else {
          const color = await page.evaluate(() => {
            const label = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === '個 降らせました');
            if (!label?.parentElement) return null;
            const digits = [...label.parentElement.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^\d$/.test(e.textContent.trim()));
            return digits.length ? [...new Set(digits.map((e) => getComputedStyle(e).color))].join(' / ') : null;
          });
          check('終了画面の個数の数字の色（kiyono）', '紙44行目', color === 'rgb(252, 76, 2)', 'rgb(252, 76, 2)＝名簿の #fc4c02', color ?? '数字が見つからない');
        }
      }
      await ctx.close();
    }
  } catch (e) { add('C1 札つきの住所で来た初めての人', '紙44・46行目', '否', '途中で転ばずに歩けること', String(e).split('\n')[0]); }

  // ───────────────────────────────── C2. 控えがある人は、札があっても自分の色のまま
  try {
    const ctx = await browser.newContext(CTX);
    watchRequests(ctx, 'C2');
    await ctx.addInitScript(() => { try { localStorage.setItem('hai_to_diamond:last_selected_member_id', 'eguchi'); } catch { /* 使えない端末 */ } });
    const page = await openEntry(ctx, '/hai-to-diamond/kiyono/2');
    if (!page) {
      add('C2 控えがある人が札つきの住所で来る', '紙46行目', '未再現', '入口が出る', '2分待っても入口が出なかった');
    } else {
      const started = await startPlay(page, 'C2');
      if (started !== 'ok') {
        add('C2 控えがある人が札つきの住所で来る', '紙46行目', started === 'qa無し' ? '否' : '未再現', '「QA」の印が出て、再生すると色えらびが出る', started);
      } else {
        const id = await currentId(page);
        check('控え eguchi の人は札 kiyono でも自分の色のまま', '紙46行目', id === 'eguchi', 'eguchi', id || '今の色が見つからない');
      }
      await ctx.close();
    }
  } catch (e) { add('C2 控えがある人が札つきの住所で来る', '紙46行目', '否', '途中で転ばずに歩けること', String(e).split('\n')[0]); }

  // ───────────────────────────────── D. 色の並びを「一列」に切り替える
  try {
    const ctx = await browser.newContext(CTX);
    watchRequests(ctx, 'D');
    const page = await openEntry(ctx, '/hai-to-diamond');
    if (!page) {
      add('D 色の並び', '紙11・13・14行目', '未再現', '入口が出る', '2分待っても入口が出なかった');
    } else if (!(await openSettings(page))) {
      add('D 色の並び', '紙11・14行目', '未再現', '設定の板が開く', '⚙を2回押しても板が開かなかった');
    } else {
      await page.getByText('一列', { exact: true }).click({ timeout: 8000 });
      await page.waitForTimeout(800);
      const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('hai_to_diamond:settings') || '{}').colorLayout ?? null; } catch { return null; } });
      check('「一列」が端末の覚え書きに残る', '紙14行目', saved === 'row', 'hai_to_diamond:settings の colorLayout = row', `= ${saved}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const again = await page.waitForFunction(() => document.body.innerText.includes('はじまります'), null, { timeout: 120000 }).then(() => true, () => false);
      if (!again) {
        add('開き直しても一列のまま', '紙14行目', '未再現', '開き直して入口が出る', '2分待っても入口が出なかった');
      } else {
        const reopened = await openSettings(page);
        const pressed = reopened ? await page.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.innerText.trim()).join(',')) : '(板が開かない)';
        check('開き直しても一列のまま', '紙14行目', pressed.includes('一列'), '設定で「一列」が選ばれている', pressed);
        await page.getByText('閉じる', { exact: true }).click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);
        const started = await startPlay(page, 'D');
        if (started !== 'ok') {
          add('一列の帯の💎の大きさ', '紙13行目', started === 'qa無し' ? '否' : '未再現', '「QA」の印が出て、再生すると一列の帯が出る', started);
        } else {
          const band = await page.evaluate(() => {
            const all = [...document.querySelectorAll('[data-diamond-color-id]')];
            const vis = all.filter((e) => getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0.01);
            const c = vis.find((e) => e.getAttribute('data-diamond-center') === 'true') ?? vis[0];
            if (!c) return null;
            const cx = c.getBoundingClientRect().x + c.getBoundingClientRect().width / 2;
            return {
              total: all.length,
              sizes: vis.map((e) => { const r = e.getBoundingClientRect(); return { d: Math.abs(r.x + r.width / 2 - cx), w: Math.round(r.width) }; })
                .sort((a, b) => a.d - b.d).map((s) => s.w),
            };
          });
          if (!band) {
            add('一列の帯の💎の大きさ', '紙13行目', '未再現', '真ん中76px・離れるほど46/38/34px', '帯の💎が1つも見えなかった');
          } else {
            check('一列の帯は14色', '紙13行目', band.total === 14, '14個', `${band.total}個`);
            const want = [76, 46, 46, 38, 38, 34, 34];
            const got = band.sizes.slice(0, 7);
            check('一列の帯の💎の大きさ', '紙13行目', got.length === 7 && want.every((v, i) => Math.abs(got[i] - v) <= 1), '真ん中から 76 / 46 / 38 / 34px', band.sizes.join(' '));
          }
        }
      }
      await ctx.close();
    }
  } catch (e) { add('D 色の並び', '紙11・13・14行目', '否', '途中で転ばずに歩けること', String(e).split('\n')[0]); }

  // ───────────────────────────────── E. 動画が届かない
  try {
    const ctx = await browser.newContext(CTX);
    watchRequests(ctx, 'E');
    // YouTube へ行く道を全部ふさいだ端末を作る（紙40行目）
    await ctx.route((u) => /(^|\.)(youtube|ytimg|googlevideo)\./.test(u.hostname) || u.hostname.includes('youtube'), (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(url('/hai-to-diamond'), { waitUntil: 'domcontentloaded' });
    const shown = await page.waitForFunction(() => document.body.innerText.includes('動画を読み込めませんでした'), null, { timeout: 40000 }).then(() => true, () => false);
    const txt = await page.evaluate(() => document.body.innerText);
    check('動画が届かない時の案内', '紙40行目', shown && txt.includes('動画を読み込めませんでした。通信を確かめて、もう一度お試しください'), '動画を読み込めませんでした。通信を確かめて、もう一度お試しください', shown ? txt.split('\n').find((l) => l.includes('読み込めませんでした')) ?? '(拾えない)' : '40秒待っても案内が変わらなかった');
    check('「もう一度」ボタンが出る', '紙40行目', txt.includes('もう一度'), 'もう一度', txt.includes('もう一度') ? 'ある' : '無い');
    await ctx.close();
  } catch (e) { add('E 動画が届かない', '紙40行目', '否', '途中で転ばずに歩けること', String(e).split('\n')[0]); }
} finally {
  await browser.close();
}

// ───────────────────────────────── 台本自身の見張り
check('確かめ用の送信止めの印「QA」', '紙29行目', qaMarks.length > 0 && qaMarks.every((m) => m.endsWith('=QA')), '曲を通すどの道でも「QA」が出ている', qaMarks.join(' / ') || '曲を通す道を1本も歩けなかった');
check('自分の記録を送る要求が1件も出ない', '紙29行目', offending.length === 0, 'GET 以外で YouTube・Google 以外へ行く要求が0件', offending.length ? offending.slice(0, 5).join(' ｜ ') : '0件');
check('画面のつまずき', '紙全体', errors.length === 0, 'つまずき0件', errors.length ? errors.slice(0, 3).join(' ｜ ') : '0件');

console.log(JSON.stringify(items, null, 1));
const ng = items.filter((i) => i.判定 === '否').length;
const na = items.filter((i) => i.判定 === '未再現').length;
console.log(`スクリーンショット: ${OUT}`);
console.log(ng ? '否' : na ? `合（未再現 ${na}件）` : '合');
process.exit(ng ? 1 : 0);
