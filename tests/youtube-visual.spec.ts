import { test, expect } from '@playwright/test';

// 底部バーのクリップ領域（ミニプレーヤー h-[72px]、FloatingBar h-14=56px を含む高さ80px）
const BOTTOM = { x: 0, y: 764, width: 390, height: 80 };
// ヘッダーのクリップ領域（sticky header）
const HEADER = { x: 0, y: 0, width: 390, height: 60 };

// 動画一覧が表示されるまで待機するヘルパー
// data-testid="zapping-card" または 「N件」テキストのどちらかが出れば OK
async function waitForGrid(page: import('@playwright/test').Page) {
  await Promise.race([
    page.waitForSelector('[data-testid="zapping-card"]', { timeout: 20000 }),
    page.waitForSelector('p:has-text("件")', { timeout: 20000 }),
  ]);
  // アニメーション・非同期レンダリング待ち
  await page.waitForTimeout(300);
}

test.describe('HELLO! VIDEO — ビジュアルリグレッション', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/youtube');
    await waitForGrid(page);
    // アニメーション終了を待つ
    await page.waitForTimeout(500);
  });

  // ---------------------------------------------------------------
  // H1: 初期状態
  // ---------------------------------------------------------------
  test('H1: 初期状態 — ヘッダーと底部にバーが出ていない', async ({ page }) => {
    // ヘッダーに余計なチップがないこと
    await expect(page).toHaveScreenshot('h1-header.png', { clip: HEADER });

    // 明示的アサート: 意図しない要素が存在しない
    // ※ h1-bottom.png は動的カードコンテンツが含まれ不安定なため省略（toBeAttached で代替）
    await expect(page.getByTestId('mini-player')).not.toBeAttached();
    await expect(page.getByTestId('floating-bar')).not.toBeAttached();
  });

  // ---------------------------------------------------------------
  // H2: 再生 → 一覧に戻る
  //   ・ミニプレーヤーが底部に表示される
  //   ・ヘッダーに余計な要素が増えていない
  // ---------------------------------------------------------------
  test('H2: 再生後に一覧に戻る — ミニプレーヤー表示', async ({ page }) => {
    // ザッピンググリッドの最初の動画をタップ（短タップ = 即再生）
    // data-testid がある新コード / CSS fallback で旧コードにも対応
    const zappingCard = page.getByTestId('zapping-card')
      .or(page.locator('div[class*="grid-cols-2"] > button'));
    await zappingCard.first().click();

    // PlayView が表示されるまで待つ（data-testid="play-view" が visible になるまで）
    const playView = page.getByTestId('play-view');
    await expect(playView).toBeVisible({ timeout: 8000 });

    // 一覧に戻る（PlayView のヘッダーボタン — PickupView の同名要素と区別するためスコープ指定）
    await playView.getByRole('button', { name: /NOW PLAYING/ }).click();
    await waitForGrid(page);
    await page.waitForTimeout(300);

    // ヘッダースクリーンショット（余計なチップが増えていないか）
    await expect(page).toHaveScreenshot('h2-header.png', { clip: HEADER });
    // 底部スクリーンショット（NOW PLAYINGバナーのみ）
    await expect(page).toHaveScreenshot('h2-bottom.png', { clip: BOTTOM });

    // 明示的アサート
    await expect(page.getByTestId('mini-player')).toBeVisible();
    await expect(page.getByTestId('floating-bar')).not.toBeAttached();
  });

  // ---------------------------------------------------------------
  // H3: 検索 → 選択 → FloatingBar
  //   ・FloatingBar にシャッフルボタンが存在しない
  //   ・NOW PLAYINGバナーが出ていない状態
  // ---------------------------------------------------------------
  test('H3: 選択中 — FloatingBarにシャッフルボタンがない', async ({ page }) => {
    // 検索
    await page.getByRole('textbox').fill('ハロ！ステ');
    await page.waitForTimeout(800);

    // ChapterCard の + ボタンをクリックして選択
    const addBtn = page.getByTestId('chapter-card-add')
      .or(page.locator('div[class*="divide-y"] > button > div[class*="w-11"]'));
    await addBtn.first().click();
    await page.waitForTimeout(300);

    // 底部スクリーンショット（FloatingBarのみ）
    await expect(page).toHaveScreenshot('h3-bottom.png', { clip: BOTTOM });

    // 明示的アサート: シャッフルボタンが存在しない
    const floatingBar = page.getByTestId('floating-bar');
    await expect(floatingBar).toBeVisible();
    await expect(floatingBar.getByRole('button', { name: /シャッフル/ })).not.toBeAttached();
    await expect(floatingBar.getByRole('button', { name: /shuffle/i })).not.toBeAttached();
  });

  // ---------------------------------------------------------------
  // H4: 再生中に選択 → 2本バーが重ならない
  //   ・ミニプレーヤーが bottom-14 に上がる
  //   ・FloatingBar が bottom-0 にある
  //   ・2本が視覚的に重なっていない
  // ---------------------------------------------------------------
  test('H4: 再生中に選択 — バナーとFloatingBarが重ならない', async ({ page }) => {
    // まず1本再生して一覧に戻る
    const zappingCard = page.getByTestId('zapping-card')
      .or(page.locator('div[class*="grid-cols-2"] > button'));
    await zappingCard.first().click();
    const playView = page.getByTestId('play-view');
    await expect(playView).toBeVisible({ timeout: 8000 });
    await playView.getByRole('button', { name: /NOW PLAYING/ }).click();
    await waitForGrid(page);

    // 検索して選択
    await page.getByRole('textbox').fill('ハロ！ステ');
    await page.waitForTimeout(800);
    const addBtn2 = page.getByTestId('chapter-card-add')
      .or(page.locator('div[class*="divide-y"] > button > div[class*="w-11"]'));
    await addBtn2.first().click();
    await page.waitForTimeout(300);

    // 底部スクリーンショット（2本バー、重なりなし）
    // ミニプレーヤー 72px + FloatingBar 56px = 128px をカバー
    const BOTTOM_WIDE = { x: 0, y: 716, width: 390, height: 128 };
    await expect(page).toHaveScreenshot('h4-bottom-two-bars.png', { clip: BOTTOM_WIDE });

    // 明示的アサート
    await expect(page.getByTestId('mini-player')).toBeVisible();
    await expect(page.getByTestId('floating-bar')).toBeVisible();
  });
});
