// 灰toダイヤモンド「原石の版」— 曲の区切りと、時刻ごとの削れ具合。
//
// 区切りの時刻は Hop 指定（2026-09-26 の依頼文。時刻は区切りの「終わり」）。
// YOKOOOOOHAMA ARENA Live Edit.（_56xLKRcVYM）基準。動画を差し替えたら測り直す。
// 削れ具合は時刻の純関数。見返し（seek）で時刻が戻っても、その時刻の姿に戻れる。

export type SectionKey =
  | "intro" | "headChorus" | "prelude" | "verseA" | "verseB" | "chorus" | "interlude"
  | "verseA2" | "verseB2" | "rap" | "epiano" | "finalChorus" | "outro" | "cheers";

export interface Section {
  key: SectionKey;
  /** 区切りの終わり（秒） */
  end: number;
  /** 区切りの終わりの時点での削れ具合（0..1・累積）。区切りの中では前の区切りの値からここまで進む */
  cutEnd: number;
}

/** 区切りの表。end は Hop 指定の時刻、cutEnd は【仮】（削れる量の配分は作り手が決めてよい範囲）。
 *  削れ具合は「面の枚数の割合」として使う（器が面を削れる順に並べ、(番号+0.5)÷枚数 がこの値を越えた面から削れる）。
 *  面は 74 枚なので、ラップ（15拍・1拍1秒）とエレピ（15段・1段1秒）にそれぞれ 15 枚ずつ＝約 0.20 ずつを割り当て、
 *  「ビートごとに1枚」「鍵盤のように1枚ずつ」が枚数どおりになるようにしてある */
export const SECTIONS: readonly Section[] = [
  { key: "intro",       end: 27,  cutEnd: 0 },      // 暗闇に灰色の原石が浮かぶ
  { key: "headChorus",  end: 42,  cutEnd: 0 },      // 中から光が漏れ、完成形がちらっと透ける
  { key: "prelude",     end: 56,  cutEnd: 0 },      // ゆっくり回り始める
  { key: "verseA",      end: 86,  cutEnd: 0.06 },   // 光の筋が2本ずつ・最初のひび（4枚）
  { key: "verseB",      end: 102, cutEnd: 0.16 },   // 粒が回り、当たった所が削れて面ができる（7枚）
  { key: "chorus",      end: 132, cutEnd: 0.34 },   // 粒が揃って大きく削る（13枚）
  { key: "interlude",   end: 147, cutEnd: 0.34 },   // 脈打ち・削りかすが飛び散る
  { key: "verseA2",     end: 162, cutEnd: 0.42 },   // 1番と同じ流れで一段上（6枚）
  { key: "verseB2",     end: 178, cutEnd: 0.52 },   // （7枚）
  { key: "rap",         end: 193, cutEnd: 0.72 },   // ビートごとに面が1枚ずつカッと刻まれる（15枚）
  { key: "epiano",      end: 208, cutEnd: 0.92 },   // 鍵盤のように面が1枚ずつ磨かれて光る（15枚）
  { key: "finalChorus", end: 253, cutEnd: 1 },      // 残りの灰が全部はがれて完成・光が上へ伸びる（残り6枚）
  { key: "outro",       end: 270, cutEnd: 1 },      // 完成したダイヤが回りながら余韻
  { key: "cheers",      end: Infinity, cutEnd: 1 }, // 削りかすがまとめて降り注いで積もる
];

/** 大サビの頭からこの秒数で残りの灰が全部はがれ、完成の瞬間（光を放つ）になる【仮】 */
export const COMPLETE_AFTER_SEC = 4;
/** 完成の瞬間の時刻（秒）。大サビの区切りの始まり＋COMPLETE_AFTER_SEC */
export const COMPLETE_TIME = 208 + COMPLETE_AFTER_SEC;
/** 削りかすがまとめて降り注ぎ始める時刻（秒）＝歓声パートの頭（4:30・Hop指定）。
 *  ページが 268.5 秒で呼ぶ launchToSky() ではなく、こちらの時刻で始める【仮】 */
export const RAIN_TIME = 270;
/** 降り注ぎが終わって山が出来上がるまでの秒数【仮】 */
export const RAIN_SEC = 6;
/** ラップで面を1枚ずつ刻む間隔（秒）【仮】。曲のBPMは測っていないので、見た目で決めた値。15秒で15枚 */
export const RAP_BEAT_SEC = 1.0;
/** エレピで面を1枚ずつ磨く間隔（秒）【仮】。15秒で15枚 */
export const EPIANO_STEP_SEC = 1.0;

/** その時刻がどの区切りか（番号） */
export function sectionIndexAt(t: number): number {
  for (let i = 0; i < SECTIONS.length; i++) if (t < SECTIONS[i].end) return i;
  return SECTIONS.length - 1;
}
export function sectionAt(t: number): Section {
  return SECTIONS[sectionIndexAt(t)];
}
/** その区切りの中でどこまで進んだか 0..1 */
export function sectionProgress(t: number): number {
  const i = sectionIndexAt(t);
  const start = i === 0 ? 0 : SECTIONS[i - 1].end;
  const end = SECTIONS[i].end;
  if (!Number.isFinite(end)) return Math.min(1, (t - start) / 10);
  return Math.max(0, Math.min(1, (t - start) / Math.max(0.001, end - start)));
}

/** 削れ具合 0..1（時刻の純関数）。
 *  区切りの中は前の区切りの値から cutEnd へ直線で進む。ラップだけはビートごとの階段。
 *  大サビは頭から COMPLETE_AFTER_SEC 秒で 1 に達する（残りの灰が一気にはがれる） */
export function cutFractionAt(t: number): number {
  const i = sectionIndexAt(t);
  const s = SECTIONS[i];
  const from = i === 0 ? 0 : SECTIONS[i - 1].cutEnd;
  if (s.key === "finalChorus") {
    const k = Math.max(0, Math.min(1, (t - (SECTIONS[i - 1].end)) / COMPLETE_AFTER_SEC));
    return from + (1 - from) * k;
  }
  if (s.key === "rap") {
    const start = SECTIONS[i - 1].end;
    // 区切りの頭の拍で1枚目、以後1拍ごとに1枚。区切りの終わりまでに全部の枚数が刻まれる
    const beats = Math.floor((s.end - start) / RAP_BEAT_SEC);
    const done = Math.min(beats, Math.floor((t - start) / RAP_BEAT_SEC) + 1);
    return from + (s.cutEnd - from) * (done / beats);
  }
  if (s.key === "epiano") {
    const start = SECTIONS[i - 1].end;
    const steps = Math.floor((s.end - start) / EPIANO_STEP_SEC);
    const done = Math.min(steps, Math.floor((t - start) / EPIANO_STEP_SEC) + 1);
    return from + (s.cutEnd - from) * (done / steps);
  }
  return from + (s.cutEnd - from) * sectionProgress(t);
}

/** 完成したか（放った後か） */
export function isCompleteAt(t: number): boolean {
  return t >= COMPLETE_TIME;
}
