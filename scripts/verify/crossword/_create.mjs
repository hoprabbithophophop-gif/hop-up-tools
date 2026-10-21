// 作る画面（/crossword/create・4段の流れ。Hop 決定 2026-10-19 夜〜10-20）を台本から動かす共通の小物。
// 画面の作りの正は src/pages/crossword/create/CreatePage.tsx・components/BulkEntry.tsx・components/HintField.tsx。
// 押す所は画面に付いている data-* の印で探す（文言が変わっても台本が壊れにくいように）。
//   1 答え: [data-bulk-text]（書く欄）・[data-bulk-mode-button="write"|"hint"]（書く｜ヒントを付ける）・[data-bulk-mark="語"]（下線の語）
//           ・[data-bulk-search]（組み合わせを探す）
//   ヒントの窓: [data-hint-sheet]・#cw-hint（URL・検索の欄）・[data-hint-kind]（選んだヒントの札）
//   2 盤:   [data-bulk-proposal]（案1〜3）・[data-create-board]（盤）・[data-bulk-adopt]（この盤で進む）
//   3 カギ: [data-clue-row="答え"]・[data-pick-hint]（未選択 → ヒントを選ぶ）・[data-hint-state]（ヒントの行き先を開くリンク。危ない形の時はリンクにしない）・[data-hint-change]（変える → ヒントの窓）・[data-missing-hints]・[data-open-share]
//   4 の窓: [data-share-sheet]・#cw-title・[data-save]・[data-share-blocks]（押せない理由）
//   段の札: [data-step-tab="1〜4"]（押すとその段へ）
// どれも棚・受付係には書かない（保存を押す台本は、保存の受付係をそれぞれの台本の中で受け止める）

// 作る画面の札となぞる動きを出さない印（_lib.mjs の SEEN_MARKS と同じ物。印を自分で立てる台本用）
export const CREATE_MARKS = {
  crossword_seen_tip_cross: '1',
  crossword_seen_tip_move: '1',
  crossword_seen_tip_saved: '1',
  crossword_seen_trace: '1',
};

// 今の段（1〜3。4の窓は3の段の上に出るので 3）
export const shownStep = async (page) => Number(await page.locator('[data-create-step]').getAttribute('data-create-step'));
// 今の段の札（「1 答え」など。黒い札＝aria-current="step"）
export const currentStepLabel = (page) => page.locator('nav li[aria-current="step"]').textContent();
// 段の札を押す（札は押せるボタン。Hop 決定 2026-10-22）
export const stepTab = (page, n) => page.locator(`[data-step-tab="${n}"]`).click();

// 1の段の書く欄に文字列を入れる（「ヒントを付ける」側にいれば「書く」へ切り替えてから）。入れた後は欄を離れる
export async function writeLines(page, text) {
  const area = page.locator('[data-bulk-text]');
  if ((await area.count()) === 0 && (await page.locator('[data-bulk-mode-button="write"]').count())) await page.locator('[data-bulk-mode-button="write"]').click();
  await area.waitFor({ timeout: 30000 });
  await area.fill(text);
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450); // 欄を離れた後の 400ms の片付け（帯を消す）を待つ
}

// 「ヒントを付ける」側へ（書いた行の一覧が出る）
export async function hintMode(page) {
  const b = page.locator('[data-bulk-mode-button="hint"]');
  await b.waitFor({ timeout: 20000 });
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await page.locator('[data-bulk-lines]').waitFor({ timeout: 10000 });
}

// 1の段で下線の語を押してヒントの窓を開く
export async function openHintSheet(page, surface) {
  await hintMode(page);
  await page.locator(`[data-bulk-mark="${surface}"]`).first().click();
  await page.locator('[data-hint-sheet]').waitFor({ timeout: 10000 });
}

// ヒントの窓を「閉じる」で閉じる
export async function closeHintSheet(page) {
  await page.locator('[data-hint-sheet]').getByRole('button', { name: '閉じる', exact: true }).first().click();
  await page.locator('[data-hint-sheet]').waitFor({ state: 'detached', timeout: 10000 });
}

// 開いているヒントの窓で、https のリンクをヒントにする（棚を読まない。リンクの形の確かめは画面の中だけ）
export async function setLinkHint(page, url) {
  await page.locator('[data-hint-sheet] #cw-hint').fill(url);
  await page.locator('[data-hint-sheet] [data-hint-kind]').waitFor({ timeout: 10000 });
}

export const exampleUrl = (word) => `https://example.com/${encodeURIComponent(word)}`;

// 1の段で、答えの語それぞれにリンクのヒントを付ける
export async function hintAllInAnswers(page, surfaces, urlOf = exampleUrl) {
  for (const s of surfaces) {
    await openHintSheet(page, s);
    await setLinkHint(page, urlOf(s));
    await closeHintSheet(page);
  }
}

// 「組み合わせを探す」→ 2の段。組み立ての動き（50回×100ms）と探す処理が終わって「この盤で進む」が押せるまで待つ
export async function toBoard(page, timeout = 45000) {
  await page.locator('[data-bulk-search]').click();
  await page.locator('[data-create-step="2"]').waitFor({ timeout: 10000 });
  await page.locator('[data-bulk-adopt]:enabled').waitFor({ timeout });
}

// 「この盤で進む」→ 3の段
export async function toClues(page) {
  await page.locator('[data-bulk-adopt]').click();
  await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 10000 });
}

// 3の段で、ヒントが未選択の語に全部リンクのヒントを付ける（「未選択 → ヒントを選ぶ」から窓を開く）
export async function hintAllInClues(page, urlOf = exampleUrl) {
  for (let i = 0; i < 70; i++) {
    const pick = page.locator('[data-clue-row]:has([data-pick-hint])').first();
    if ((await pick.count()) === 0) return;
    const key = await pick.getAttribute('data-clue-row');
    await pick.locator('[data-pick-hint]').click();
    await page.locator('[data-hint-sheet]').waitFor({ timeout: 10000 });
    await setLinkHint(page, urlOf(key));
    await closeHintSheet(page);
  }
}

// 3の段の「共有する」→ 4の窓
export async function openShare(page) {
  await page.locator('[data-open-share]:enabled').click();
  await page.locator('[data-share-sheet]').waitFor({ timeout: 10000 });
}

// 3の段のカギの欄（答えごと）
export const clueInput = (page, key) => page.locator(`[data-clue-row="${key}"] input`);
// 3の段に並んだ答え
export const clueKeys = (page) => page.locator('[data-clue-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-clue-row')));
// 2の段の盤のマス（"x,y:字" の並び。盤が同じかを比べるため）
export const boardCells = (page) =>
  page.locator('[data-create-board] [id^="cell-"]').evaluateAll((els) => els.map((e) => `${e.id.slice(5)}:${(e.getAttribute('aria-label') || '').split('・').at(-1)}`).sort());
// 端末に残った作りかけ（無ければ null）
export const readDraft = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('crossword_draft') || 'null'); } catch { return null; } });

// 1の段から3の段まで通しで進める（全部の語にリンクのヒントを付けてから探す）
export async function throughToClues(page, text, surfaces) {
  await writeLines(page, text);
  await hintAllInAnswers(page, surfaces);
  await toBoard(page);
  await toClues(page);
}
