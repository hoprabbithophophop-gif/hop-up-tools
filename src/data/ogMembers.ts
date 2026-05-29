import type { Member } from "@/types/profile";

/**
 * M-line club 所属の OG・卒業メンバー名簿（推し登録用）
 * 出典: https://www.upfc.jp/m-line/ （2026-05 時点の掲載者 28名）
 *
 * 用途: /fc-ticket の Subscribe「推しを登録」で選択肢として表示し、
 *       fc_news のタイトルに名前が含まれるイベントを自動チェックする。
 *
 * 注意:
 * - `group` は推しピッカー上の表示グループ（全員 OG_GROUP_LABEL でまとめる）。
 * - `formerGroup` は元所属（参考表示）。途中移籍は「A→B」で経路を残す。
 * - `hasEvents` は 2026-05 時点で fc_news タイトルに実在を確認できた人（先頭に並べる）。
 * - `color` は OG 一律グレー（実メンバーカラーは使わない方針）。
 * - 呼び名（nicks）は確実なデータが無いため付けない。検索はフルネームで行う。
 * - 名簿は M-line の在籍変動で増減する。
 */

export const OG_GROUP_LABEL = "OG・卒業メンバー";

const OG_COLOR = "#cccccc";

export interface OgMember extends Member {
  /** 元所属グループ（参考）。途中移籍は「A→B」表記。 */
  formerGroup?: string;
  /** 2026-05 時点で fc_news にFCイベントが存在（先頭表示） */
  hasEvents?: boolean;
}

export const OG_MEMBERS: OgMember[] = [
  // ── fc_news に実在イベントを確認済み（イベント件数の多い順）──────────────
  { name: "竹内朱莉",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "アンジュルム",     hasEvents: true },
  { name: "植村あかり",   group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "Juice=Juice",     hasEvents: true },
  { name: "佐々木莉佳子", group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "アンジュルム",     hasEvents: true },
  { name: "勝田里奈",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "アンジュルム",     hasEvents: true },
  { name: "中島早貴",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "℃-ute",           hasEvents: true },
  { name: "佐藤優樹",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。",   hasEvents: true },
  { name: "須藤茉麻",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "Berryz工房",       hasEvents: true },
  { name: "譜久村聖",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。",   hasEvents: true },
  { name: "鈴木愛理",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "℃-ute",           hasEvents: true },
  { name: "熊井友理奈",   group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "Berryz工房",       hasEvents: true },
  { name: "矢島舞美",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "℃-ute",           hasEvents: true },
  { name: "石田亜佑美",   group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。",   hasEvents: true },
  { name: "稲場愛香",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "カントリー・ガールズ→Juice=Juice", hasEvents: true },
  { name: "山岸理子",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "つばきファクトリー", hasEvents: true },
  { name: "中澤裕子",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。",   hasEvents: true },
  { name: "森戸知沙希",   group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "カントリー・ガールズ→モーニング娘。", hasEvents: true },
  { name: "浅倉樹々",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "つばきファクトリー", hasEvents: true },

  // ── M-line 在籍だが現時点の fc_news に未登場（登録は可・今後拾える可能性）──
  { name: "飯田圭織",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "保田圭",       group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "矢口真里",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "石川梨華",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "辻希美",       group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "高橋愛",       group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "田中れいな",   group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "宮崎由加",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "Juice=Juice" },
  { name: "宮本佳林",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "ハロプロ研修生→Juice=Juice" },
  { name: "飯窪春菜",     group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "モーニング娘。" },
  { name: "小関舞",       group: OG_GROUP_LABEL, color: OG_COLOR, formerGroup: "こぶしファクトリー" },
];
