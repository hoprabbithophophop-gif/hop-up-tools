// 値→カタカナの答えに直す変換表。公式サイトの内容ではなく一般の知識だけで書いてある。
// 答えはクロスワードの決まりどおり大きなカナだけ（小さい字は大きい字に統一、長音は「ー」のまま）。

export const PREFECTURES = {
  北海道: 'ホッカイドウ', 青森: 'アオモリ', 岩手: 'イワテ', 宮城: 'ミヤギ', 秋田: 'アキタ', 山形: 'ヤマガタ', 福島: 'フクシマ',
  茨城: 'イバラキ', 栃木: 'トチギ', 群馬: 'グンマ', 埼玉: 'サイタマ', 千葉: 'チバ', 東京: 'トウキョウ', 神奈川: 'カナガワ',
  新潟: 'ニイガタ', 富山: 'トヤマ', 石川: 'イシカワ', 福井: 'フクイ', 山梨: 'ヤマナシ', 長野: 'ナガノ', 岐阜: 'ギフ',
  静岡: 'シズオカ', 愛知: 'アイチ', 三重: 'ミエ', 滋賀: 'シガ', 京都: 'キョウト', 大阪: 'オオサカ', 兵庫: 'ヒョウゴ',
  奈良: 'ナラ', 和歌山: 'ワカヤマ', 鳥取: 'トットリ', 島根: 'シマネ', 岡山: 'オカヤマ', 広島: 'ヒロシマ', 山口: 'ヤマグチ',
  徳島: 'トクシマ', 香川: 'カガワ', 愛媛: 'エヒメ', 高知: 'コウチ', 福岡: 'フクオカ', 佐賀: 'サガ', 長崎: 'ナガサキ',
  熊本: 'クマモト', 大分: 'オオイタ', 宮崎: 'ミヤザキ', 鹿児島: 'カゴシマ', 沖縄: 'オキナワ',
};

// 出身地の値から都道府県名（表の見出し）を取り出す。「東京都」「北海道」「大阪府」「神奈川県」のどれでも。
export function prefectureOf(value) {
  if (!value) return null;
  const v = value.replace(/\s+/g, '');
  for (const key of Object.keys(PREFECTURES)) {
    if (v.startsWith(key)) return key;
  }
  return null;
}

export const MONTHS = ['イチガツ', 'ニガツ', 'サンガツ', 'シガツ', 'ゴガツ', 'ロクガツ', 'シチガツ', 'ハチガツ', 'クガツ', 'ジュウガツ', 'ジュウイチガツ', 'ジュウニガツ'];

// 星座（西洋占星術の一般的な区切り）
const ZODIAC = [
  [1, 20, 'ミズガメザ', 'みずがめ座'], [2, 19, 'ウオザ', 'うお座'], [3, 21, 'オヒツジザ', 'おひつじ座'], [4, 20, 'オウシザ', 'おうし座'],
  [5, 21, 'フタゴザ', 'ふたご座'], [6, 22, 'カニザ', 'かに座'], [7, 23, 'シシザ', 'しし座'], [8, 23, 'オトメザ', 'おとめ座'],
  [9, 23, 'テンビンザ', 'てんびん座'], [10, 24, 'サソリザ', 'さそり座'], [11, 23, 'イテザ', 'いて座'], [12, 22, 'ヤギザ', 'やぎ座'],
];
export function zodiacOf(month, day) {
  const i = ZODIAC.findIndex(([m, d]) => m === month);
  const [, startDay, kana, label] = ZODIAC[i];
  const j = day >= startDay ? i : (i + 11) % 12;
  return { kana: ZODIAC[j][2], label: ZODIAC[j][3] };
}

// 干支（生まれ年）
// 1字の答えは盤に置けないので動物の読みにする
const ETO = [['ネズミ', '子'], ['ウシ', '丑'], ['トラ', '寅'], ['ウサギ', '卯'], ['タツ', '辰'], ['ヘビ', '巳'], ['ウマ', '午'], ['ヒツジ', '未'], ['サル', '申'], ['トリ', '酉'], ['イヌ', '戌'], ['イノシシ', '亥']];
export function etoOf(year) {
  const [kana, label] = ETO[((year - 4) % 12 + 12) % 12];
  return { kana, label };
}

export const BLOOD = { A: 'エーガタ', B: 'ビーガタ', O: 'オーガタ', AB: 'エービーガタ' };
export function bloodOf(value) {
  if (!value) return null;
  const m = /^(AB|A|B|O)/i.exec(value.replace(/\s+/g, '').toUpperCase());
  return m ? m[1] : null;
}

// 「2008年4月1日」「2008年04月01日」の形から年月日を取り出す
export function dateOf(value) {
  if (!value) return null;
  const m = /(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?/.exec(value);
  return m ? { y: +m[1], m: +m[2], d: m[3] ? +m[3] : null } : null;
}

// ひらがな→カタカナ、小さい字→大きい字
const SMALL = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ' };
export function toAnswerKana(s) {
  const kata = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return kata.replace(/[ァィゥェォッャュョヮ]/g, (c) => SMALL[c]);
}
export const isAnswerKana = (s) => /^[ア-ンヴー]+$/.test(s);
