/**
 * ありがとビートの採譜済みコールを、棚（calls）へ入れる。
 *
 * 【何度でもやり直せるようにしてある】
 * 元データは `src/pages/hi-tension/arigatoBeatCalls.ts` にあるので、棚の中身が壊れても
 * これを流し直せば元に戻せる。手作業のコピペで入れると、その瞬間にこの逃げ道を失う。
 *
 * 使い方:
 *   node scripts/song-structure/seed-arigato-beat-calls.mjs            … 何が入るか出すだけ
 *   node scripts/song-structure/seed-arigato-beat-calls.mjs --apply    … 実際に入れる
 *   node scripts/song-structure/seed-arigato-beat-calls.mjs --reset --apply … 一括投入ぶんを消してから入れ直す
 *
 * 入れないもの:
 *   `（）` で囲まれたもの … コールではなく、レクチャー動画で言っていた心掛け・合いの手
 *
 * 来歴について:
 *   置き方は 'bulk'（一括投入）。耳でもマスでもないので区別できるようにしてある。
 *   これが無いと、将来の「はみ出しの検査」が一括投入ぶんを含んだまま回ってしまう。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SLUG = "arigato-beat";
/** 採譜の基準になった動画。秒はこの動画のもの */
const SRC_VIDEO = "n5AVvFwbeaM";
const BPM = 149;

const apply = process.argv.includes("--apply");
const reset = process.argv.includes("--reset");

/** 元データ（TypeScript のファイル）から、コールの並びを読む */
function readCalls() {
  const src = fs.readFileSync(path.join(ROOT, "src/pages/hi-tension/arigatoBeatCalls.ts"), "utf8");
  const out = [];
  const re = /\{\s*t:\s*([\d.]+),\s*lenBeats:\s*([\d.]+),\s*note:\s*"([^"]*)"\s*\}/g;
  let m;
  while ((m = re.exec(src))) out.push({ t: +m[1], lenBeats: +m[2], note: m[3] });
  return out;
}

/** `（）` で囲まれたものはコールではない */
const isNotACall = (note) => /^[（(]/.test(note.trim());

const beatSec = 60 / BPM;
const all = readCalls();
const rows = all.filter((c) => !isNotACall(c.note)).map((c) => ({
  start_sec: Math.round(c.t * 1000) / 1000,
  // 長さの元データは「拍数」なので、秒への変換に BPM 149 が焼き付く。
  // 変換に使う値と、来歴に書く値は必ず同じにすること。
  len_sec: Math.round(c.lenBeats * beatSec * 1000) / 1000,
  kind: "single",
  text: c.note.trim(),
  status: "visible",
  src_video_id: SRC_VIDEO,
  src_offset_sec: 0,
  src_bpm: BPM,
  src_anchor_sec: all[0]?.t ?? 0,
  placed_by_method: "bulk",
}));

console.log(`元データ ${all.length}件 → 除外 ${all.length - rows.length}件（（）付き） → 入れる ${rows.length}件`);
console.log(`長さの変換に使うBPM: ${BPM}（来歴の src_bpm と同じ値）`);
if (!apply) {
  console.log("\n最初の3件:");
  for (const r of rows.slice(0, 3)) console.log("  ", JSON.stringify(r));
  console.log("\n※ 出しただけ。実際に入れるには --apply を付ける");
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が要る（値は表示も保存もしないこと）");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: song, error: e1 } = await db
  .from("song_structures").select("id").eq("slug", SLUG).maybeSingle();
if (e1 || !song) { console.error("曲が棚に無い。先に二品目を実行すること"); process.exit(1); }

if (reset) {
  const { error, count } = await db
    .from("calls").delete({ count: "exact" })
    .eq("song_id", song.id).eq("placed_by_method", "bulk");
  if (error) { console.error("消せなかった:", error.message); process.exit(1); }
  console.log(`一括投入ぶん ${count}件を消した（耳・マスで置かれた行には触っていない）`);
}

const { error, count } = await db
  .from("calls")
  .insert(rows.map((r) => ({ ...r, song_id: song.id, created_by: "admin" })), { count: "exact" });
if (error) { console.error("入れられなかった:", error.message); process.exit(1); }
console.log(`${count}件を入れた`);
