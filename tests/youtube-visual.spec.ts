import { test, expect } from '@playwright/test';

// 底部バーのクリップ領域（NOW PLAYINGバナー h-12=48px、FloatingBar h-14=56px を含む高さ60px）
const BOTTOM = { x: 0, y: 784, width: 390, height: 60 };
// ヘッダーのクリップ領域（sticky header）
const HEADER = { x: 0, y: 0, width: 390, height: 60 };

// ザッピンググリッドが表示されるまで待機するヘルパー
async function waitForGrid(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="zapping-card"]', { timeout: 15000 });
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
    // 底部にバーが出ていないこと
    await expect(page).toHaveScreenshot('h1-bottom.png', { clip: BOTTOM });

    // 明示的アサート: 意図しない要素が存在しない
    await expect(page.getByTestId('now-playing-banner')).not.toBeAttached();
    await expect(page.getByTestId('floating-bar')).not.toBeAttached();
  });

  // ---------------------------------------------------------------
  // H2: 再生 → 一覧に戻る
  //   ・NOW PLAYINGバナーが底部に1本だけ表示される
  //   ・ヘッダーに「再生中」チップ等が増えていない
  // ---------------------------------------------------------------
  test('H2: 再生後に一覧に戻る — NOW PLAYINGバナー1本のみ', async ({ page }) => {
    // ザッピンググリッドの最初の動画をタップ（短タップ = 即再生）
    await page.getByTestId('zapping-card').first().click();

    // PlayView が表示されるまで待つ
    await expect(page.getByText('NOW PLAYING').first()).toBeVisible({ timeout: 8000 });

    // 一覧に戻る（PlayView のヘッダーボタン）
    await page.getByRole('button', { name: /NOW PLAYING/ }).first().click();
    await waitForGrid(page);
    await page.waitForTimeout(300);

    // ヘッダースクリーンショット（余計なチップが増えていないか）
    await expect(page).toHaveScreenshot('h2-header.png', { clip: HEADER });
    // 底部スクリーンショット（NOW PLAYINGバナーのみ）
    await expect(page).toHaveScreenshot('h2-bottom.png', { clip: BOTTOM });

    // 明示的アサート
    await expect(page.getByTestId('now-playing-banner')).toBeVisible();
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
    await page.getByTestId('chapter-card-add').first().click();
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
  //   ・NOW PLAYINGバナーが bottom-14 に上がる
  //   ・FloatingBar が bottom-0 にある
  //   ・2本が視覚的に重なっていない
  // ---------------------------------------------------------------
  test('H4: 再生中に選択 — バナーとFloatingBarが重ならない', async ({ page }) => {
    // まず1本再生して一覧に戻る
    await page.getByTestId('zapping-card').first().click();
    await expect(page.getByText('NOW PLAYING').first()).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /NOW PLAYING/ }).first().click();
    await waitForGrid(page);

    // 検索して選択
    await page.getByRole('textbox').fill('ハロ！ステ');
    await page.waitForTimeout(800);
    await page.getByTestId('chapter-card-add').first().click();
    await page.waitForTimeout(300);

    // 底部スクリーンショット（2本バー、重なりなし）
    // BOTTOM より上まで広く撮る（バナーが bottom-14 = 56px上にいるため）
    const BOTTOM_WIDE = { x: 0, y: 728, width: 390, height: 116 };
    await expect(page).toHaveScreenshot('h4-bottom-two-bars.png', { clip: BOTTOM_WIDE });

    // 明示的アサート
    await expect(page.getByTestId('now-playing-banner')).toBeVisible();
    await expect(page.getByTestId('floating-bar')).toBeVisible();
  });
});
