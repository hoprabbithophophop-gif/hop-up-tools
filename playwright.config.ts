import { defineConfig } from '@playwright/test';

// BASE_URL 環境変数で切り替え可能。未指定時はブランチプレビューを使う
const BASE_URL =
  process.env.BASE_URL ?? 'https://feature-chapter-pickup-redes.hop-up-tools.pages.dev';

export default defineConfig({
  testDir: './tests',
  // スナップショットはテストファイルの隣に保存
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
  use: {
    baseURL: BASE_URL,
    // モバイル相当のビューポート（iPhone 14）
    viewport: { width: 390, height: 844 },
    // 失敗時のみスクリーンショット（デバッグ用）
    screenshot: 'only-on-failure',
    // アニメーションを無効化（スナップショット安定化）
    reducedMotion: 'reduce',
  },
  // CI でない場合は 1 ワーカー（テストの順序依存を避ける）
  workers: 1,
});
