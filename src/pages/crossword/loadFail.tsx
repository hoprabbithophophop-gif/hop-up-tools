// 問題を読めなかった時に出す、消えない1枚（2回目のレビューの表 4番。Hop 決定 2026-11-01「4番やって」）。
// 前は数秒で消える知らせだけで、解く画面は作る画面に入れ替わっていた。X で住所が回る道具なので、解きに来た人が迷わないよう
// 「見つからない」「非表示」「いま読み込めない（サイトの側の不具合かもしれない）」を分けて出し、次にすることのボタンを置く。
// 解く画面（CrosswordPage）とランキングの画面（RankingPage）で同じ文を使う。文は【仮】（クロスワードの文は CC に任せる。Hop 2026-10-25）
import { Link } from "react-router-dom";
import { Icon } from "./components/ui";
import { C } from "./style";

/** missing = 棚に無い（住所が切れた・消された）／hidden = 通報で隠れた／error = 棚に問い合わせられなかった */
export type LoadFail = "missing" | "hidden" | "error";

export const LOAD_FAIL_TEXT: Record<LoadFail, { title: string; body: string }> = {
  missing: { title: "この問題は見つかりません", body: "URL が途中で切れているか、作った人が問題を消した可能性があります。" },
  hidden: { title: "この問題は非表示になりました", body: "通報を受けて、表示を止めています。" },
  error: { title: "いま読み込めません", body: "サイトの側で問題が起きている可能性があります。少し待ってから、もう一度読み込んでください。" },
};

const ACTIONS = { gallery: "パズルギャラリーへ", reload: "もう一度読み込む" };

/** 消えない1枚。読み込めない時だけ「もう一度読み込む」を出す（見つからない・非表示は読み直しても変わらないため）。
 *  見出しは、ほかに見出しの無い画面（解く画面）では h1、ある画面（ランキング）では h2 */
export function LoadFailCard({ kind, level = 1 }: { kind: LoadFail; level?: 1 | 2 }) {
  const t = LOAD_FAIL_TEXT[kind];
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div data-load-fail={kind} role="alert" className="bg-white p-6 text-center">
      <Heading className="text-lg font-bold [text-wrap:balance]" style={{ color: C.ink }}>
        {t.title}
      </Heading>
      <p className="text-sm mt-2 [text-wrap:pretty]" style={{ color: C.secondary }}>
        {t.body}
      </p>
      <div className="flex flex-col gap-3 mt-6">
        {kind === "error" && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center justify-center gap-2 w-full min-h-[44px] py-3 bg-primary hover:bg-secondary text-white font-bold transition-colors"
          >
            <Icon size={16} icon="refresh" /> {ACTIONS.reload}
          </button>
        )}
        <Link
          to="/crossword"
          className={`flex items-center justify-center w-full min-h-[44px] py-3 font-bold transition-colors ${kind === "error" ? "bg-surface-container-high hover:bg-surface-container-highest" : "bg-primary hover:bg-secondary text-white"}`}
          style={kind === "error" ? { color: C.ink } : undefined}
        >
          {ACTIONS.gallery}
        </Link>
      </div>
    </div>
  );
}
