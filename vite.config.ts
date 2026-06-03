import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// ビルド時のコミットハッシュ（更新確認用のバージョン表記）。
// Cloudflare Pages では CF_PAGES_COMMIT_SHA が自動で入る。ローカルは "dev"。
function getCommitSha(): string {
  return process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? "dev";
}

// 版数表記の表示可否。本番（Cloudflare Pages の production ブランチ = main）では隠し、
// dev・プレビューブランチでは更新確認用に出す。CF_PAGES_BRANCH はデプロイ時にブランチ名が入る
// （production デプロイなら "main"）。ローカルは undefined → 表示。
function shouldShowVersion(): boolean {
  return process.env.CF_PAGES_BRANCH !== "main";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __COMMIT_SHA__: JSON.stringify(getCommitSha()),
    __SHOW_VERSION__: JSON.stringify(shouldShowVersion()),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
