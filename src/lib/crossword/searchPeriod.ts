// 公式の発信を探す補助の「いつごろ」（Hop 依頼 2026-10-19 案A: 年と月の選択。日付は打たせない）。
// Google は after:/before:、X は since:/until: で期間を狭める。どちらも検索の言葉に足すだけ。
export interface SearchPeriod {
  year: number;
  /** 1〜12。無ければ年いっぱい */
  month?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

// 期間の始まりの日と、終わりの翌日（X の until はその日を含まないので翌日で渡す。Google の before も同じ日付で揃える）
export function periodRange(p: SearchPeriod): { from: string; toExclusive: string } {
  const m = p.month ?? 1;
  const from = `${p.year}-${pad(m)}-01`;
  const next = p.month ? (m === 12 ? { y: p.year + 1, m: 1 } : { y: p.year, m: m + 1 }) : { y: p.year + 1, m: 1 };
  return { from, toExclusive: `${next.y}-${pad(next.m)}-01` };
}

export function googlePeriodWords(p: SearchPeriod | null): string {
  if (!p) return "";
  const r = periodRange(p);
  return ` after:${r.from} before:${r.toExclusive}`;
}

export function xPeriodWords(p: SearchPeriod | null): string {
  if (!p) return "";
  const r = periodRange(p);
  return ` since:${r.from} until:${r.toExclusive}`;
}

// 年の選択肢。今年から 2000 年まで【仮】
export function periodYears(now = new Date()): number[] {
  const y = now.getFullYear();
  return Array.from({ length: y - 2000 + 1 }, (_, i) => y - i);
}
