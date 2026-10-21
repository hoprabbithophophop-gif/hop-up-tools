// 作る画面（/crossword/create・案A「作る｜試す」。Hop 決定 2026-10-22）を台本から動かす共通の小物。
// 画面の作りの正は src/pages/crossword/create/CreatePage.tsx・components/BulkEntry.tsx・components/HintField.tsx。
// 押す所は画面に付いている data-* の印で探す（文言が変わっても台本が壊れにくいように）。印の一覧（この並びが台本と画面の約束）:
//   上:       [data-create-head]（見出しと切り替え 44px）・[data-mode-tab="make"|"try"]（作る｜試す。aria-pressed）
//   小さい盤: [data-mini]（110px）・[data-mini-board]・[data-mini-stats]（N語・Mマス・交差K）・[data-mini-status]（盤が無い理由）・[data-mini-open]（押すと広げた盤）
//   広げた盤: [data-board-sheet]（role=dialog）・[data-board-close]・[data-bulk-proposal]（案1〜3）・[data-create-board]（盤）・[data-board-stats]
//             ・[data-reshuffle]・[data-unplaced]・[data-pins-release]・[data-not-connected]・[data-shape-guide]
//   書く欄:   [data-bulk-text]・[data-bulk-insert="brackets"|"bar"|"arrow"|"maru"]・[data-bulk-markbar]（下の帯）・[data-bulk-unmarkbar]
//   語の一覧: [data-word-list]・[data-word-row="答え"]（押すと語の窓）・[data-word-missing="clue"|"hint"]（足りない言葉。済むと消える）
//             ・[data-word-unplaced]（盤に置けなかった語）・[data-bulk-reason="理由"]（弾いた語の行）
//   語の窓:   [data-word-sheet="答え"]（role=dialog。[data-hint-sheet] も付いている）・#cw-clue（カギの欄）・[data-clue-left]・[data-clue-over]
//             ・[data-hint-guide]・[data-hint-state]（ヒントの行き先を開くリンク）・#cw-hint（ヒントの欄）・[data-hint-kind]（選んだヒントの札）・[data-word-close]
//   下の段:   [data-dock]（60px）・[data-dock-try]（試しに解く）・[data-dock-share]（公開の準備。そろうと [data-strong]）
//   共有の窓: [data-share-sheet]・#cw-title・#cw-creator・#cw-tag・[data-share-blocks]（押せない理由。そろうと ="ok"）・[data-save]・[data-copyright]・[data-share-close]
//   試す:     [data-create-mode="try"]・[data-trial]（解く画面の部品）・[data-trial-empty]（盤が無い時）
// どれも棚・受付係には書かない（保存を押す台本は、保存の受付係をそれぞれの台本の中で受け止める）

// 作る画面の札を出さない印（_lib.mjs の SEEN_MARKS と同じ物。印を自分で立てる台本用）
export const CREATE_MARKS = {
  crossword_seen_tip_cross: '1',
  crossword_seen_tip_move: '1',
  crossword_seen_tip_saved: '1',
};

// 初めて開いた時に入っている見本の4行（Hop 決定 2026-10-22）
export const SAMPLE = ['【ラジオ】で新曲が初めて流れた', '【本気｜マジ】で応援している', 'ニャーと鳴く動物→【ネコ】', '○○○はユーカリを食べる→【コアラ】'].join('\n');
export const SAMPLE_WORDS = ['ラジオ', 'マジ', 'ネコ', 'コアラ'];

// 今の切り替え（make / try）
export const currentMode = (page) => page.locator('[data-mode-tab][aria-pressed="true"]').getAttribute('data-mode-tab');
export const toMode = async (page, m) => {
  await page.locator(`[data-mode-tab="${m}"]`).click();
  await page.locator(`[data-create-mode="${m}"]`).waitFor({ timeout: 10000 });
};

// 書く欄に文字列を入れる。入れた後は欄を離れる
export async function writeLines(page, text) {
  const area = page.locator('[data-bulk-text]');
  await area.waitFor({ timeout: 30000 });
  await area.fill(text);
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450); // 欄を離れた後の 400ms の片付け（帯を消す）を待つ
}

// 盤が今の答えで組み上がるまで待つ（小さい盤に「N語・Mマス・交差K」が出る。探している間は前の盤のまま）
export async function waitBoard(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-mini-stats]');
    return !!s && s.textContent.trim() !== '';
  }, null, { timeout });
  // 探し始めるまでの待ち（250ms）と探す処理（最長2秒）が落ち着くまで、少し待って変わらないのを見る
  let prev = '';
  for (let i = 0; i < 40; i++) {
    const now = await page.locator('[data-mini-stats]').textContent();
    if (now && now === prev) {
      await page.waitForTimeout(300);
      if ((await page.locator('[data-mini-stats]').textContent()) === now) return now;
    }
    prev = now;
    await page.waitForTimeout(300);
  }
  return prev;
}

// 語の窓を開く・閉じる
export async function openWordSheet(page, key) {
  const row = page.locator(`[data-word-row="${key}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.locator(`[data-word-sheet="${key}"]`).waitFor({ timeout: 10000 });
}
export async function closeWordSheet(page) {
  await page.locator('[data-word-close]').first().click();
  await page.locator('[data-word-sheet]').waitFor({ state: 'detached', timeout: 10000 });
}
// 前の台本の呼び名（ヒントの窓＝語の窓）
export const openHintSheet = openWordSheet;
export const closeHintSheet = closeWordSheet;

// 開いている語の窓で、https のリンクをヒントにする（棚を読まない。リンクの形の確かめは画面の中だけ）
export async function setLinkHint(page, url) {
  const sheet = page.locator('[data-word-sheet]');
  const link = sheet.locator('[data-hint-source="link"]');
  if (await link.count()) await link.click();
  await sheet.locator('#cw-hint').fill(url);
  await sheet.locator('[data-hint-kind]').waitFor({ timeout: 10000 });
}
// 開いている語の窓でカギを書く
export async function setClue(page, text) {
  await page.locator('[data-word-sheet] #cw-clue').fill(text);
}

export const exampleUrl = (word) => `https://example.com/${encodeURIComponent(word)}`;

// 語の一覧の答え（書いた順）
export const wordKeys = (page) => page.locator('[data-word-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-word-row')));

// 語ごとに、ヒントが無ければリンクのヒントを付け、カギが空なら clueOf(key) を書く（clueOf が null を返す語はカギを書かない）
export async function fillWords(page, keys, { clueOf = (k) => `${k}の問題`, urlOf = exampleUrl } = {}) {
  for (const k of keys) {
    const needHint = (await page.locator(`[data-word-row="${k}"] [data-word-missing="hint"]`).count()) > 0;
    const needClue = (await page.locator(`[data-word-row="${k}"] [data-word-missing="clue"]`).count()) > 0;
    if (!needHint && !needClue) continue;
    await openWordSheet(page, k);
    if (needClue && clueOf(k) !== null) await setClue(page, clueOf(k));
    if (needHint) await setLinkHint(page, urlOf(k));
    await closeWordSheet(page);
  }
}

// 「公開の準備」→ 共有の窓
export async function openShare(page) {
  await page.locator('[data-dock-share]').click();
  await page.locator('[data-share-sheet]').waitFor({ timeout: 10000 });
}
export async function closeShare(page) {
  await page.locator('[data-share-close]').click();
  await page.locator('[data-share-sheet]').waitFor({ state: 'detached', timeout: 10000 });
}

// 小さい盤を押して広げた盤の画面へ・閉じる
export async function openBoard(page) {
  await page.locator('[data-mini-open]').click();
  await page.locator('[data-board-sheet]').waitFor({ timeout: 10000 });
}
export async function closeBoard(page) {
  await page.locator('[data-board-close]').click();
  await page.locator('[data-board-sheet]').waitFor({ state: 'detached', timeout: 10000 });
}

// 広げた盤のマス（"x,y:字" の並び。盤が同じかを比べるため）
export const boardCells = (page) =>
  page.locator('[data-create-board] [id^="cell-"]').evaluateAll((els) => els.map((e) => `${e.id.slice(5)}:${(e.getAttribute('aria-label') || '').split('・').at(-1)}`).sort());
// 端末に残った作りかけ（無ければ null）
export const readDraft = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('crossword_draft') || 'null'); } catch { return null; } });

// 作りかけの盤から マス→字 を作る（盤の左上を 0,0 にそろえる。試すの盤の #cell-x-y と同じ座標）
export function draftCells(draft) {
  const full = {};
  for (const it of draft.board) it.answer.forEach((ch, i) => { full[it.direction === 'horizontal' ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`] = ch; });
  const xs = Object.keys(full).map((k) => +k.split(',')[0]);
  const ys = Object.keys(full).map((k) => +k.split(',')[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const out = {};
  for (const [k, ch] of Object.entries(full)) {
    const [x, y] = k.split(',').map(Number);
    out[`${x - minX},${y - minY}`] = ch;
  }
  return out;
}

// 試すの盤（解く画面の部品）で1マスずつ字を入れる。゛゜の付く字は清音を押してから ゛゜ を押す
export async function solveTrial(page, cells, { skip = [] } = {}) {
  const kp = page.locator('[data-coach="keypad"]');
  for (const [k, ch] of Object.entries(cells)) {
    if (skip.includes(k)) continue;
    const [x, y] = k.split(',').map(Number);
    await page.locator(`[data-trial] #cell-${x}-${y}`).click();
    await kp.waitFor({ timeout: 10000 });
    const parts = ch.normalize('NFD');
    await kp.getByRole('button', { name: parts[0], exact: true }).first().click();
    if (parts.length > 1) await kp.getByRole('button', { name: parts.charCodeAt(1) === 0x3099 ? '゛' : '゜' }).first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
}
