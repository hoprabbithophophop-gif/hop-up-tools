#!/usr/bin/env node
// src/lib/icsCore.ts を supabase/functions/_shared/icsCore.ts にそのままコピーする。
//
// なぜ必要か: 購読ICSの組み立てレシピ（VALARM/GEOの行、公演のグルーピング判定など）を
// ブラウザ側とサーバー側（Supabase Edge Function）の「2つの台所」に分けて書くと、
// 片方だけ直して味がズレる事故が起きる。src/lib/icsCore.ts を「唯一のレシピ」とし、
// サーバー側にはこのスクリプトでコピーを置く（Edge Functionのデプロイは
// ファイル内容をそのままアップロードする方式のため、importで直接共有はできない）。
//
// 使い方:
//   node --experimental-strip-types scripts/sync-ics-shared.mjs         # コピーを更新
//   node --experimental-strip-types scripts/sync-ics-shared.mjs --check # ズレていないか確認のみ（更新しない）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src", "lib", "icsCore.ts");
const dest = join(root, "supabase", "functions", "_shared", "icsCore.ts");

const content = readFileSync(src, "utf8");
const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  const current = existsSync(dest) ? readFileSync(dest, "utf8") : null;
  if (current === content) {
    console.log("OK: supabase/functions/_shared/icsCore.ts is in sync with src/lib/icsCore.ts");
    process.exit(0);
  }
  console.error(
    "NG: supabase/functions/_shared/icsCore.ts is out of sync with src/lib/icsCore.ts\n" +
      "  run: node --experimental-strip-types scripts/sync-ics-shared.mjs",
  );
  process.exit(1);
}

writeFileSync(dest, content, "utf8");
console.log("synced: src/lib/icsCore.ts -> supabase/functions/_shared/icsCore.ts");
