// ヒント欄の「① 公式の発信を探す」所で選んだ物と打った言葉を覚えておく（Hop 決定 2026-10-22「専ヲタとしては毎回モーニングから BEYOOOOONDS に
// フォーカスあて直すのめんどいし、検索ワードも保持しておいてほしい」→ 選んだ答え「グループはずっと・言葉は問題の間」）。
//   グループの選択（アメブロ・X のグループ・Instagram のアカウント）: ブラウザ（localStorage）にずっと覚える。最後に選んだ物から始まる
//   探す言葉といつごろ（年・月）: 持ち主の画面（作る画面・ヒントを直す画面）が開いている間だけ。ブラウザには残さない
// 持ち主の画面がこの useHintSearch を1つ持ち、HintField に渡す。語ごとに窓を開き直しても、同じ1つを使うので残る
import { useCallback, useState } from "react";
import { OFFICIAL_BLOGS } from "../../../data/officialBlogs";
import { OFFICIAL_ACCOUNT_GROUPS } from "../../../data/officialAccounts";

export interface HintSearch {
  /** 公式ブログの選択（"g:グループ"＝そのグループのブログ全部／"b:ブログ"＝1つだけ） */
  blogChoice: string;
  /** X のグループ */
  xGroupKey: string;
  /** Instagram のアカウント */
  igHandle: string;
  /** 探す言葉（アメブロ・X・Instagram・リンクで共通の1つ） */
  keyword: string;
  /** いつごろ（年・月）。空なら期間なし */
  year: string;
  month: string;
}
type Groups = Pick<HintSearch, "blogChoice" | "xGroupKey" | "igHandle">;

// localStorage の鍵（crossword 専用の名前）
const GROUPS_KEY = "crossword_hint_groups";
const DEFAULT_GROUPS: Groups = {
  blogChoice: `g:${OFFICIAL_BLOGS[0].key}`,
  xGroupKey: OFFICIAL_ACCOUNT_GROUPS[0].key,
  igHandle: OFFICIAL_ACCOUNT_GROUPS[0].ig[0],
};

// 覚えた値が今の名簿に無い時（名簿が変わった・壊れた値）は先頭に戻す。今の期間で選べないブログは HintField が選び直す
const isBlogChoice = (v: unknown): v is string =>
  typeof v === "string" && OFFICIAL_BLOGS.some((g) => v === `g:${g.key}` || g.ids.some((id) => v === `b:${id}`));
const isXGroup = (v: unknown): v is string => typeof v === "string" && OFFICIAL_ACCOUNT_GROUPS.some((g) => g.key === v);
const isIgHandle = (v: unknown): v is string => typeof v === "string" && OFFICIAL_ACCOUNT_GROUPS.some((g) => g.ig.includes(v));

function readGroups(): Groups {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return DEFAULT_GROUPS;
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    return {
      blogChoice: isBlogChoice(d?.blog) ? d.blog : DEFAULT_GROUPS.blogChoice,
      xGroupKey: isXGroup(d?.x) ? d.x : DEFAULT_GROUPS.xGroupKey,
      igHandle: isIgHandle(d?.ig) ? d.ig : DEFAULT_GROUPS.igHandle,
    };
  } catch {
    // 読めない（使えないブラウザ・壊れた値）時は先頭から。覚えられないだけで探すことはできる
    return DEFAULT_GROUPS;
  }
}

function writeGroups(patch: Partial<Groups>) {
  try {
    const g = { ...readGroups(), ...patch };
    localStorage.setItem(GROUPS_KEY, JSON.stringify({ blog: g.blogChoice, x: g.xGroupKey, ig: g.igHandle }));
  } catch {
    /* 覚えられなくても探せる */
  }
}

export interface HintSearchApi {
  value: HintSearch;
  /** 画面の中だけで変える（言葉・いつごろ、期間に合わせたブログの選び直し） */
  set: (patch: Partial<HintSearch>) => void;
  /** 人が選び直したグループ。画面の中で変え、ブラウザにも覚える（期間に合わせた自動の選び直しは覚えない。期間を戻した時に元の選択へ戻れるように） */
  remember: (patch: Partial<Groups>) => void;
}

export function useHintSearch(): HintSearchApi {
  const [value, setValue] = useState<HintSearch>(() => ({ ...readGroups(), keyword: "", year: "", month: "" }));
  const set = useCallback((patch: Partial<HintSearch>) => setValue((prev) => ({ ...prev, ...patch })), []);
  const remember = useCallback((patch: Partial<Groups>) => {
    setValue((prev) => ({ ...prev, ...patch }));
    writeGroups(patch);
  }, []);
  return { value, set, remember };
}
