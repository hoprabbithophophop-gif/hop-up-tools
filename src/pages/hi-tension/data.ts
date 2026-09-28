/**
 * 練習できる映像。各映像は video_id ごとに独立した✋プール／ヒートマップを持つ
 *（曲が同じでも編集＝タップ時刻が違うのでデータは混ぜない）。
 * 配列が2本以上になると入口に映像切替トグルが出る（1本の間は出さない）。
 * MV(WU-IF-cLPCY)は 2026-06-10 公開・埋め込み可(playableInEmbed:true)を確認して追加。
 * ※サーバー側 Edge関数 submit-hi-session の VALID_VIDEO_IDS にも同じ id が必要。
 */
export type PracticeVideo = {
  id: string;
  label: string;
};

export const PRACTICE_VIDEOS: readonly PracticeVideo[] = [
  { id: "mn1wkO0Ysbw", label: "LIVE映像" },
  { id: "WU-IF-cLPCY", label: "MV" },
  { id: "ZLs8GVsbEgY", label: "Stage Practice" },
] as const;

/** 既定（1本目）の video_id。api.ts 等の引数デフォルトに使う＝従来挙動を維持。 */
export const VIDEO_ID = PRACTICE_VIDEOS[0].id;
// 待機室で muted 再生してネットワーク/プレイヤー/CDN接続を暖機する別動画。
// 別URLで完全独立に暖機しつつ、公式 views にも追加貢献。
// https://www.youtube.com/watch?v=vsD2lApG9yc の 0:20〜1:22（62秒分）。
export const WARMUP_VIDEO_ID = "vsD2lApG9yc";
export const WARMUP_VIDEO_START = 20;
export const WARMUP_VIDEO_END = 82;

export type HiTensionMember = {
  id: string;
  color: string;
};

export type UnitRow = {
  unit: "CHICA#TETSU" | "雨ノ森 川海" | "SeasoningS";
  members: HiTensionMember[];
};

export const UNIT_ROWS: readonly UnitRow[] = [
  {
    unit: "CHICA#TETSU",
    members: [
      { id: "nishida",   color: "#da1884" },
      { id: "eguchi",    color: "#fdda24" },
    ],
  },
  {
    unit: "雨ノ森 川海",
    members: [
      { id: "takase",    color: "#00c7b1" },
      { id: "maeda",     color: "#59cbe8" },
      { id: "okamura",   color: "#F57EB6" },
      { id: "kiyono",    color: "#fc4c02" },
    ],
  },
  {
    unit: "SeasoningS",
    members: [
      { id: "hirai",     color: "#582c83" },
      { id: "kobayashi", color: "#007749" },
      { id: "satoyoshi", color: "#005eb8" },
    ],
  },
] as const;

// 2026-06-13 加入の新メンバー3人（メンカラ同日21:00発表）。サブユニット未確定のため
// UNIT_ROWS（ユニット別の段）には入れず、色選択では最下段に独立した1行で出す。
// 小島はな=ホワイト#ffffff, 大坪茉乃=ライトグリーン#d0df00, 杉山結菜=レッド#e70033。
// 全員、公式サイトのメンバーカラースウォッチと一致確認済み（杉山は暫定#FF0000から公式#e70033へ差し替え）。
// ゲーム本編(再生中)の「客電落ち」アリーナ背景。ロビー(入口)・EndCardでも共有して
// 統一する（白メンカラが明るい背景に溶けるため・2026-06-13 hop指定）。
export const ARENA_BG = "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)";

export const NEW_MEMBERS: readonly HiTensionMember[] = [
  { id: "kojima",   color: "#ffffff" },
  { id: "otsubo",   color: "#d0df00" },
  { id: "sugiyama", color: "#e70033" },
] as const;

export const ALL_HI_MEMBERS: HiTensionMember[] = [
  ...UNIT_ROWS.flatMap(r => r.members),
  ...NEW_MEMBERS,
];

export function findMember(id: string | null): HiTensionMember | null {
  if (!id) return null;
  return ALL_HI_MEMBERS.find(m => m.id === id) ?? null;
}
