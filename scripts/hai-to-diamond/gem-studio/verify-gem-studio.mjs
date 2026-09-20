// 【使い捨て】束ねた1枚のHTMLを実際に開いて、目で見えるところまで確かめる。
//   1. 石が描かれること
//   2. なぞると向きが変わること
//   3. 光のつまみで見え方が変わること
//   4. 設定の書き出しと読み戻し
//   5. 反対の色の求め方 2通りの見え方くらべ
//   6. 細い画面（横400）で横にはみ出さないこと
//   7. 写した描き手と本番の描き手が同じ絵になること（別ページ・vite の開発用の仕掛けで）
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, statSync, mkdirSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const SHOT = DIR + '/out/verify-gem-studio';
mkdirSync(SHOT, { recursive: true });
const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);

const FILE = pathToFileURL(DIR + '/out/gem-studio.bundle.html').href;
const GL = ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'];
const log = [];
const say = (...a) => { console.log(...a); log.push(a.join(' ')); };

// カードの絵をざっくり取り出す（40画素ごと）。差があるかどうかを数で見るため
const SNAP = () => {
  const c = document.getElementById('gs-canvas');
  const d = c.getContext('2d').getImageData(0, 0, 1200, 630).data;
  const out = [];
  for (let i = 0; i < d.length; i += 4 * 97) out.push(d[i], d[i + 1], d[i + 2], d[i + 3]);
  return out;
};
const diff = (a, b) => {
  let s = 0, m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); s += d; if (d > m) m = d; }
  return { mean: s / a.length, max: m };
};

let browser;
let server;
const results = {};
try {
  /* ---- 0. 束ねたHTMLそのものの形を見る ---- */
  {
    const t = readFileSync(DIR + '/out/gem-studio.bundle.html', 'utf8');
    const outside = [...t.matchAll(/<script\b[^>]*\bsrc=/gi)].length;
    results.file = {
      startsWithTitle: t.trimStart().startsWith('<title>'),
      hasHtmlTag: /<\/?(html|head|body)\b/i.test(t),
      externalScripts: outside,
      importMeta: t.includes('import.meta'),
      stylesheets: [...t.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)].map((m) => m[0]),
      bytes: Buffer.byteLength(t),
    };
    say('0. 束ねたHTML:', JSON.stringify(results.file));
    if (!results.file.startsWithTitle) throw new Error('<title> から始まっていない');
    if (results.file.hasHtmlTag) throw new Error('html/head/body の囲いが残っている');
    if (outside > 0) throw new Error('外から読み込む script が残っている');
    if (results.file.importMeta) throw new Error('import.meta が残っている');
    if (results.file.stylesheets.some((s) => !s.includes('https://fonts.googleapis.com'))) {
      throw new Error('許されていない外の見た目の指定が混ざっている');
    }
  }

  browser = await chromium.launch({ args: GL });

  /* ---- 1. 開いて石が描かれるか ---- */
  const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => say('[画面のつまずき]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') say('[画面の言い分]', m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__studioReady === true || window.__studioError, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  const err = await page.evaluate(() => window.__studioError ?? null);
  if (err) throw new Error('開けなかった: ' + err);

  const drawn = await page.evaluate(() => {
    const c = document.getElementById('gs-canvas');
    const d = c.getContext('2d').getImageData(0, 0, 1200, 630).data;
    let opaque = 0, bright = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 40) opaque++;
      const l = d[i - 3] * 0.3 + d[i - 2] * 0.59 + d[i - 1] * 0.11;
      if (d[i] > 40 && l > 140) bright++;
    }
    // 石の層だけを取り出して、そこに石が入っているかを直に数える。
    // 「明るい所の数」は演出の効き方で上下するので、有無の判定には使わない
    let gemPx = 0;
    const gl = window.__studioLayers && window.__studioLayers.gem;
    if (gl) {
      const g = gl.getContext('2d').getImageData(0, 0, gl.width, gl.height).data;
      for (let i = 3; i < g.length; i += 4) if (g[i] > 40) gemPx++;
    }
    return { opaque, bright, gemPx, total: (1200 * 630) };
  });
  results.drawn = drawn;
  say('1. 石が描かれた画素', drawn.gemPx, '／ カードの明るい所', drawn.bright);
  // 自動の補正が入ると背景まで canvas が塗るので、カード全体の塗られた画素では
  // 石の有無を見られない。石の層の中身の数で見る
  if (drawn.gemPx < 50000) throw new Error('石が描かれていない（石の層が空に近い）');
  await page.screenshot({ path: `${SHOT}/studio_01_gem_drawn.png`, fullPage: false });

  const cardBox = page.locator('#gs-cardbox');
  // 項目はタブに分かれたので、触る前にそのタブを開く
  const openTab = async (key) => {
    await page.locator(`.gs-tab[data-tab="${key}"]`).click();
    await page.waitForTimeout(200);
  };
  const clip = async () => {
    const b = await cardBox.boundingBox();
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  };

  /* ---- 2. なぞると向きが変わるか ---- */
  const rotBefore = await page.evaluate(() => JSON.stringify(window.__studioState.rotation.rows));
  const snapBefore = await page.evaluate(SNAP);
  await page.screenshot({ path: `${SHOT}/studio_02_drag_before.png`, clip: await clip() });

  const bb = await cardBox.boundingBox();
  const k = bb.width / 1200;
  const gx = bb.x + 880 * k, gy = bb.y + 330 * k;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(gx - 16 * i, gy - 7 * i);
  await page.mouse.up();
  await page.waitForTimeout(900);

  const rotAfter = await page.evaluate(() => JSON.stringify(window.__studioState.rotation.rows));
  const snapAfter = await page.evaluate(SNAP);
  const dDrag = diff(snapBefore, snapAfter);
  await page.screenshot({ path: `${SHOT}/studio_03_drag_after.png`, clip: await clip() });
  results.drag = { changed: rotBefore !== rotAfter, pixel: dDrag };
  say('2. なぞった後の向きの変化', rotBefore !== rotAfter ? 'あり' : 'なし', '／ 絵の差 平均', dDrag.mean.toFixed(2), '最大', dDrag.max);
  if (rotBefore === rotAfter) throw new Error('なぞっても向きが変わらない');
  if (dDrag.mean < 1) throw new Error('向きは変わったのに絵が変わっていない');

  /* ---- 3. 光のつまみで見え方が変わるか ----
     光が効くのは石の面なので、石が写っている所だけを見る。
     カード全体で見ると、変わらない背景に薄められて差が見えなくなる */
  const GEM_SNAP = () => {
    const st = window.__studioState;
    const x0 = Math.max(0, Math.round(st.gem.cx - st.gem.sizePx / 2));
    const y0 = Math.max(0, Math.round(st.gem.cy - st.gem.sizePx / 2));
    const w = Math.min(1200 - x0, Math.round(st.gem.sizePx));
    const h = Math.min(630 - y0, Math.round(st.gem.sizePx));
    const d = document.getElementById('gs-canvas').getContext('2d').getImageData(x0, y0, w, h).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4 * 31) out.push(d[i], d[i + 1], d[i + 2]);
    return out;
  };
  const snapL0 = await page.evaluate(GEM_SNAP);
  await page.screenshot({ path: `${SHOT}/studio_04_light_before.png`, clip: await clip() });
  const lightBefore = await page.evaluate(() => JSON.stringify(window.__studioState.lights[0].dir));
  // 1灯目の「向き」のつまみを、実際に掴んで端まで動かす
  await openTab('light');
  const azBar = page.locator('.gs-light').first().locator('input[type=range]').first();
  const ab = await azBar.boundingBox();
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width * 0.08, ab.y + ab.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const lightAfter = await page.evaluate(() => JSON.stringify(window.__studioState.lights[0].dir));
  const snapL1 = await page.evaluate(GEM_SNAP);
  const dLight = diff(snapL0, snapL1);
  await page.screenshot({ path: `${SHOT}/studio_05_light_after.png`, clip: await clip() });
  results.light = { before: JSON.parse(lightBefore), after: JSON.parse(lightAfter), pixel: dLight };
  say('3. 光の向き', lightBefore, '→', lightAfter, '／ 絵の差 平均', dLight.mean.toFixed(2), '最大', dLight.max);
  if (lightBefore === lightAfter) throw new Error('光のつまみが効いていない');
  if (dLight.mean < 0.5) throw new Error('光を動かしても絵が変わっていない');

  /* ---- 3b. 3灯が見え方のどれくらいを持っているか ---- */
  {
    const base = await page.evaluate(() => window.__studioExport());
    const set = async (v) => {
      const st = JSON.parse(base);
      st.lights.forEach((l) => { l.intensity = v; });
      await page.evaluate((t) => window.__studioImport(t), JSON.stringify(st));
      await page.waitForTimeout(800);
      return page.evaluate(SNAP);
    };
    const off = await set(0);
    await page.screenshot({ path: `${SHOT}/studio_04b_lights_off.png`, clip: await clip() });
    const strong = await set(2);
    await page.screenshot({ path: `${SHOT}/studio_04c_lights_strong.png`, clip: await clip() });
    results.lightRange = diff(off, strong);
    say('3b. 3灯を 0 と 2 にしたときの絵の差 平均', results.lightRange.mean.toFixed(2), '最大', results.lightRange.max);
    await page.evaluate((t) => window.__studioImport(t), base);
    await page.waitForTimeout(800);
  }

  /* ---- 4. 書き出しと読み戻し（画面のボタンを実際に押して確かめる） ---- */
  const press = async (label) => {
    await openTab('io');
    await page.locator('.gs-btn', { hasText: label }).first().click();
    await page.waitForTimeout(900);
  };
  const jsonBox = async () => { await openTab('io'); return page.locator('.gs-json'); };
  await press('いまの設定を書き出す');
  const json1 = await (await jsonBox()).inputValue();
  const snapJ0 = await page.evaluate(SNAP);
  // いったん最初の状態へ崩してから、書き出した文字を欄に戻して読み込む
  await press('最初の状態に戻す');
  const snapReset = await page.evaluate(SNAP);
  const dReset = diff(snapJ0, snapReset);
  await (await jsonBox()).fill(json1);
  await press('欄の中身を読み込む');
  await press('いまの設定を書き出す');
  const json2 = await (await jsonBox()).inputValue();
  const snapJ1 = await page.evaluate(SNAP);
  const dBack = diff(snapJ0, snapJ1);
  await page.screenshot({ path: `${SHOT}/studio_06_json_restored.png`, clip: await clip() });
  results.json = {
    sameText: json1 === json2,
    afterResetPixel: dReset,
    afterRestorePixel: dBack,
    bytes: Buffer.byteLength(json1),
  };
  say('4. 書き出し→崩す→読み戻す: 文字が一致', json1 === json2 ? 'した' : 'しない',
    '／ 崩した時の絵の差 平均', dReset.mean.toFixed(2),
    '／ 戻した後の絵の差 平均', dBack.mean.toFixed(3));
  if (json1 !== json2) throw new Error('読み戻した設定を書き出すと中身が変わる');
  if (dReset.mean < 1) throw new Error('崩したつもりが絵が変わっていない（確かめになっていない）');
  if (dBack.mean > 0.5) throw new Error('読み戻しても元の絵に戻っていない');

  /* ---- 4b. 覚えておいた設定が、開き直しても残るか ----
     同じ画面を読み込み直して見る。別の画面として開くと、Playwright は覚え箱ごと
     別に用意してしまい、確かめにならない */
  {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__studioReady === true || window.__studioError, null, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    const keptJson = await page.evaluate(() => window.__studioExport());
    const kept = await page.evaluate(SNAP);
    results.reload = { sameText: keptJson === json1, pixel: diff(snapJ0, kept) };
    say('4b. 開き直したとき: 設定の文字が一致', keptJson === json1 ? 'した' : 'しない',
      '／ 絵の差 平均', results.reload.pixel.mean.toFixed(3));
    if (keptJson !== json1) throw new Error('開き直すと設定が戻っていない');
    if (results.reload.pixel.mean > 0.5) throw new Error('開き直すと絵が変わっている');
  }

  /* ---- 4c. 反対の色の選び方を、丸ボタンを押して切り替える ---- */
  {
    await openTab('glow');
    const note = () => page.locator('.gs-compnote').textContent();
    const before = await note();
    await page.locator('input[name="gs-comp"][value="hue"]').check();
    await page.waitForTimeout(600);
    const after = await note();
    results.compRadio = { before, after };
    say('4c. 丸ボタンで切り替え', before, '→', after);
    if (before === after) throw new Error('丸ボタンを押しても反対の色が変わらない');
    await page.locator('input[name="gs-comp"][value="invert"]').check();
    await page.waitForTimeout(600);
  }

  /* ---- 5. 反対の色の求め方 2通りくらべ ---- */
  const CASES = [
    { id: 'nishida', hex: '#da1884', label: 'ホットピンク #da1884' },
    { id: 'eguchi', hex: '#fdda24', label: 'イエロー #fdda24' },
    { id: 'kobayashi', hex: '#007749', label: 'グリーン #007749' },
    { id: 'kojima', hex: '#ffffff', label: 'ホワイト #ffffff' },
  ];
  const compShots = [];
  for (const c of CASES) {
    for (const method of ['invert', 'hue']) {
      const st = JSON.parse(json1);
      st.member = { id: c.id, hex: c.hex };
      st.glow.method = method;
      st.glow.comp.alpha = 0.4;     // 既定の 0.176 だと差が小さくて見比べにくいので、両方とも同じだけ上げる
      st.glow.comp.radius = 620;
      await page.evaluate((t) => window.__studioImport(t), JSON.stringify(st));
      await page.waitForTimeout(800);
      const compRgb = await page.evaluate(() => document.querySelector('.gs-compnote').textContent);
      const p = `${SHOT}/studio_comp_${c.id}_${method}.png`;
      await page.screenshot({ path: p, clip: await clip() });
      compShots.push({ path: p, label: `${c.label} ／ ${method === 'invert' ? '色を裏返す' : '色合いを180度まわす'} ／ ${compRgb}` });
      say('5.', c.label, method, compRgb);
    }
  }
  results.comp = compShots.map((s) => s.label);

  /* ---- 5b. 背景色の組 ---- */
  const setShots = [];
  {
    const setMember = async (id, hex) => {
      const st = JSON.parse(json1);
      st.member = { id, hex };
      st.glow.set = { kind: 'comp', key: 'comp', ids: [], pickedIds: [], alpha: 0.22, radius: 480, seed: 1, lift: 0 };
      await page.evaluate((t) => window.__studioImport(t), JSON.stringify(st));
      await page.waitForTimeout(700);
    };
    const options = () => page.$$eval('.gs-setopt', (bs) => bs.map((b) => ({
      key: b.dataset.key,
      label: b.getAttribute('aria-label'),
      dots: [...b.querySelectorAll('.gs-dots i')].map((i) => i.style.background || 'から'),
    })));

    const WANT = {
      nishida: ['comp', 'b1', 'o3', 'custom'],
      kojima: ['comp', 'b2', 't3', 'custom'],
      yamazaki: ['comp', 'o5', 'custom'],
      hirai: ['comp', 'b3', 'custom'],
    };
    const HEX = { nishida: '#da1884', kojima: '#ffffff', yamazaki: '#e70033', hirai: '#582c83' };
    results.sets = {};
    for (const [id, want] of Object.entries(WANT)) {
      await setMember(id, HEX[id]);
      const got = await options();
      results.sets[id] = got.map((o) => o.key + ':' + o.label);
      say('5b.', id, 'の選べる組', JSON.stringify(results.sets[id]));
      const keys = got.map((o) => o.key);
      if (JSON.stringify(keys) !== JSON.stringify(want)) {
        throw new Error(id + ' の組が合わない ' + JSON.stringify(keys) + ' 期待 ' + JSON.stringify(want));
      }
      // その色で選べる組を順に押して1枚ずつ撮る
      for (const o of got) {
        if (o.key === 'custom') continue;
        await openTab('glow');
        await page.locator(`.gs-setopt[data-key="${o.key}"]`).click();
        await page.waitForTimeout(700);
        const p = `${SHOT}/studio_set_${id}_${o.key}.png`;
        await page.screenshot({ path: p, clip: await clip() });
        setShots.push({ path: p, label: `石=${id} ／ 組=${o.key} ／ にじみ=${o.label}` });
      }
    }

    /* 濃い色の持ち上げ。hirai のときの kobayashi と satoyoshi で見る */
    await setMember('hirai', '#582c83');
    await openTab('glow');
    await page.locator('.gs-setopt[data-key="b3"]').click();
    await page.waitForTimeout(700);
    // 前のやり方の持ち上げ。自動の補正を切っているときだけ効く
    for (const lift of [0, 0.5, 1]) {
      const st = JSON.parse(await page.evaluate(() => window.__studioExport()));
      st.auto.on = false;
      st.glow.set.lift = lift;
      await page.evaluate((t) => window.__studioImport(t), JSON.stringify(st));
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => window.__studioState.glow.blobs.slice(1).map((b) => b.id + ' rgb(' + b.rgb.join(',') + ')'));
      const p = `${SHOT}/studio_lift_${String(lift).replace('.', '')}.png`;
      await page.screenshot({ path: p, clip: await clip() });
      setShots.push({ path: p, label: `石=hirai ／ 補正オフ・前の持ち上げ ${lift * 100}% ／ ${after.join(' ')}` });
      say('5b. 補正オフの持ち上げ', lift, after.join(' '));
    }
    // 自動の補正では、持ち上げは「その色が読み取れる最低限」で決まる。
    // そろえる明るさのつまみは、色ごとの尖りを選んだ時だけ効く決まりになっている
    const liftMoved = [];
    for (const tL of [0.45, 0.62, 0.8]) {
      const st = JSON.parse(await page.evaluate(() => window.__studioExport()));
      st.auto.on = true;
      st.auto.targetL = tL;
      await page.evaluate((t) => window.__studioImport(t), JSON.stringify(st));
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => window.__studioState.glow.blobs.slice(1).map((b) => b.id + ' rgb(' + b.rgb.join(',') + ') L' + b.oklch[0]));
      liftMoved.push(after.join(' '));
      say('5b. そろえる明るさ', tL, after.join(' '));
    }
    results.targetL = liftMoved;
    if (liftMoved[0] !== liftMoved[2]) throw new Error('そろえる明るさのつまみが、尖り案でないのに効いてしまっている');
    // 読み取れる最低限そのものは、色ごとに違う値になっているはず
    const readable = await page.evaluate(() =>
      ['#582c83', '#007749', '#005eb8', '#da1884'].map((h) => window.__studioShuffle.readable(h)));
    results.readable = readable;
    say('5b. 読み取れる最低の明るさ hirai/kobayashi/satoyoshi/nishida', JSON.stringify(readable.map((v) => Math.round(v * 1000) / 1000)));
    if (new Set(readable).size < 2) throw new Error('読み取れる最低の明るさが色ごとに変わっていない');

    /* 近い色どうしを並べたとき。自分で選ぶ で nishida と okamura を入れる */
    await setMember('kojima', '#ffffff');
    // 色見本は「自分で選ぶ」を選んだあとに出てくる
    await openTab('glow');
    await page.locator('.gs-setopt[data-key="custom"]').click();
    await page.waitForTimeout(500);
    for (const id of ['nishida', 'okamura']) {
      await page.locator(`.gs-cdot[data-id="${id}"]`).click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(700);
    const picked = await page.evaluate(() => window.__studioState.glow.set.pickedIds);
    const pickedBlobs = await page.evaluate(() => window.__studioState.glow.blobs.slice(1).map((b) => b.id));
    results.custom = { picked, blobs: pickedBlobs };
    say('5b. 自分で選ぶ', JSON.stringify(picked), '→ にじみ', JSON.stringify(pickedBlobs));
    if (picked.join(',') !== 'nishida,okamura') throw new Error('自分で選ぶ の中身が合わない');
    {
      const p = `${SHOT}/studio_set_custom_near.png`;
      await page.screenshot({ path: p, clip: await clip() });
      setShots.push({ path: p, label: '石=kojima ／ 自分で選ぶ ／ にじみ= nishida okamura 近い色どうし' });
    }

    /* 組を選んだ状態での書き出しと読み戻し */
    await setMember('yamazaki', '#e70033');
    await openTab('glow');
    await page.locator('.gs-setopt[data-key="o5"]').click();
    await page.waitForTimeout(700);
    const sJson1 = await page.evaluate(() => window.__studioExport());
    const sSnap1 = await page.evaluate(SNAP);
    await press('最初の状態に戻す');
    await (await jsonBox()).fill(sJson1);
    await press('欄の中身を読み込む');
    await press('いまの設定を書き出す');
    const sJson2 = await (await jsonBox()).inputValue();
    const sSnap2 = await page.evaluate(SNAP);
    const sBack = diff(sSnap1, sSnap2);
    const parsed = JSON.parse(sJson1);
    results.setJson = {
      same: sJson1 === sJson2,
      pixel: sBack,
      key: parsed.glow.set.key,
      ids: parsed.glow.set.ids,
      blobs: parsed.glow.blobs.map((b) => b.id + ' ' + b.hex + ' rgb(' + b.rgb.join(',') + ') ' + b.x + ',' + b.y + ' r' + b.radius + ' a' + b.alpha),
    };
    say('5b. 組つきの書き出し: 文字が一致', sJson1 === sJson2 ? 'した' : 'しない', '／ 絵の差 平均', sBack.mean.toFixed(3));
    say('5b. 書き出しの中身 key=' + parsed.glow.set.key, 'ids=' + JSON.stringify(parsed.glow.set.ids));
    for (const b of results.setJson.blobs) say('     にじみ', b);
    if (sJson1 !== sJson2) throw new Error('組つきの設定が往復で変わる');
    if (sBack.mean > 0.5) throw new Error('組つきの設定を読み戻しても絵が戻らない');

    /* 前の版の設定が読めるか。glow.set を抜いたものを渡す */
    const old = JSON.parse(json1);
    delete old.glow.set;
    delete old.glow.blobs;
    delete old.auto;
    await page.evaluate((t) => window.__studioImport(t), JSON.stringify(old));
    await page.waitForTimeout(700);
    const oldKind = await page.evaluate(() => window.__studioState.glow.set.kind);
    const oldSnap = await page.evaluate(SNAP);
    results.oldJson = { kind: oldKind, pixel: diff(snapJ0, oldSnap) };
    say('5b. 前の版の設定を読ませた: 選び方は', oldKind, '／ 前の版の絵との差 平均', results.oldJson.pixel.mean.toFixed(3));
    if (oldKind !== 'comp') throw new Error('前の版の設定が反対の色として読まれていない');
    if (results.oldJson.pixel.mean > 0.5) throw new Error('前の版の設定の絵が再現できていない');
  }

  /* ---- 6. 細い画面 ---- */
  const phone = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1 });
  await phone.goto(FILE, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.__studioReady === true || window.__studioError, null, { timeout: 60000 });
  await phone.waitForTimeout(1200);
  const over = await phone.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  results.phone = over;
  say('6. 横400の画面: 中身の幅', over.scrollW, '／ 画面の幅', over.clientW, '／ body の下地', over.bodyBg);
  await phone.screenshot({ path: `${SHOT}/studio_07_phone.png`, fullPage: false });
  await phone.close();
  if (over.scrollW > over.clientW + 1) throw new Error('細い画面で横にはみ出している');

  /* ---- 7. 写しと本番の突き合わせ ---- */
  server = await createServer({ root: ROOT, configFile: false, server: { port: 5191, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const eq = await browser.newPage({ viewport: { width: 760, height: 460 }, deviceScaleFactor: 1 });
  eq.on('pageerror', (e) => say('[突き合わせのつまずき]', e.message));
  await eq.goto('http://localhost:5191/scripts/hai-to-diamond/gem-studio/gem-equiv.html', { waitUntil: 'load' });
  await eq.waitForFunction(() => window.__equivReady === true, null, { timeout: 120000 });
  const equiv = await eq.evaluate(() => ({ ok: window.__equiv ?? null, err: window.__equivError ?? null }));
  results.equiv = equiv;
  say('7. 写しと本番の突き合わせ', JSON.stringify(equiv));
  await eq.screenshot({ path: `${SHOT}/studio_08_same_as_production.png`, fullPage: false });
  await eq.close();
  if (equiv.err) throw new Error('突き合わせができなかった: ' + equiv.err);
  if (!equiv.ok || equiv.ok.opaque < 1000) throw new Error('突き合わせの絵が空だった');
  if (equiv.ok.maxDiff > 2) throw new Error('写しと本番で絵が違う maxDiff=' + equiv.ok.maxDiff);

  /* ---- 見くらべの1枚にまとめる ---- */
  const sheet = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  const rows = compShots.map((s) => `<div><p class="lab">${s.label}</p><img src="data:image/png;base64,${readFileSync(s.path).toString('base64')}"></div>`).join('');
  await sheet.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#15171c;font-family:system-ui,sans-serif}
.col{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px}
.lab{color:#9aa0a6;font-size:12px;margin:0 0 5px;font-weight:600}
img{width:100%;height:auto;display:block}</style><div class="col">${rows}</div>`);
  await sheet.waitForTimeout(400);
  await sheet.screenshot({ path: `${SHOT}/studio_09_comp_methods.png`, fullPage: true });
  await sheet.close();

  /* 背景色の組も1枚にまとめる */
  const sheet2 = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  const rows2 = setShots.map((s) => `<div><p class="lab">${s.label}</p><img src="data:image/png;base64,${readFileSync(s.path).toString('base64')}"></div>`).join('');
  await sheet2.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#15171c;font-family:system-ui,sans-serif}
.col{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px}
.lab{color:#9aa0a6;font-size:12px;margin:0 0 5px;font-weight:600}
img{width:100%;height:auto;display:block}</style><div class="col">${rows2}</div>`);
  await sheet2.waitForTimeout(400);
  await sheet2.screenshot({ path: `${SHOT}/studio_12_color_sets.png`, fullPage: true });
  await sheet2.close();

  await page.close();

  say('---');
  say('束ねたHTMLの大きさ', (statSync(DIR + '/out/gem-studio.bundle.html').size / 1024).toFixed(1) + 'KB');
  say('ぜんぶ通った');
} finally {
  if (server) await server.close();
  if (browser) await browser.close();
  console.log(JSON.stringify(results, null, 1));
}
