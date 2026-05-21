import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// ビルド時のコミットハッシュ（更新確認用のバージョン表記）。
// Cloudflare Pages では CF_PAGES_COMMIT_SHA が自動で入る。ローカルは "dev"。
function getCommitSha(): string {
  return process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? "dev";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __COMMIT_SHA__: JSON.stringify(getCommitSha()),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
