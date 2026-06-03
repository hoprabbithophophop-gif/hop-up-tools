/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// vite.config.ts の define で注入されるビルド時コミットハッシュ
declare const __COMMIT_SHA__: string;
// 版数表記を表示してよいか（本番 main デプロイでは false）
declare const __SHOW_VERSION__: boolean;
