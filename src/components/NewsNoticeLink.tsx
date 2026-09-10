// 動画を使うページの題字の下に置く、お知らせへの案内。
//
// 置いてあるのは、動画を実際に再生する公開中の5ページ。
//   /youtube（HELLO! VIDEO）/the-ballad / hi-tension の入口 / hai-to-diamond の入口 / arigato-beat
//
// 文言と行き先はこのファイルの2行だけに持たせてある。
// 次のお知らせに差し替える時は、ここを直せば5ページとも変わる。
import { Link } from "react-router-dom";

/** 今出しているお知らせの行き先 */
const NEWS_PATH = "/news/2026-09-10-play-count";
/** 題字の下に出す文言 */
const NEWS_LABEL = "お知らせ：再生回数の件について";

type Props = {
  /** 題字が中央寄せのページでは "center" を渡す */
  align?: "left" | "center";
  /**
   * 題字との間。既定は "line"＝一行ぶん空けて、題字の続きとして読まれないようにする。
   * "tight" は高さの決まった帯の中など、一行ぶんが入らない所だけ。
   */
  gap?: "line" | "tight";
};

export default function NewsNoticeLink({ align = "left", gap = "line" }: Props) {
  return (
    <Link
      to={NEWS_PATH}
      style={{
        display: "block",
        marginTop: gap === "line" ? "1.1rem" : "0.45rem",
        textAlign: align,
        // 明るい地のページと暗い地のページが混ざるので、
        // 色を決め打ちせず親の文字色を薄めて使う
        color: "inherit",
        opacity: 0.62,
        fontSize: "0.75rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        textDecoration: "underline",
        textUnderlineOffset: "0.18em",
      }}
    >
      {NEWS_LABEL}
    </Link>
  );
}
