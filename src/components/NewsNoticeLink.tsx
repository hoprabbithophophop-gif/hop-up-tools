// トップページの題字の下に出す、お知らせへの案内。
//
// 一番下の並びにも「お知らせ」はあるが、あれは小さくて見落とされる。
// 出したい記事がある間だけ、開いてすぐ目に入る所にも出す。
//
// 文言と行き先はこのファイルの2行だけに持たせてある。
// 次のお知らせに差し替える時は、ここを直す。
import { Link } from "react-router-dom";

/** 今出しているお知らせの行き先 */
const NEWS_PATH = "/news/2026-09-11-play-count";
/** 題字の下に出す文言 */
const NEWS_LABEL = "お知らせ：再生回数の件について";

export default function NewsNoticeLink() {
  return (
    <Link
      to={NEWS_PATH}
      style={{
        display: "block",
        // 一行ぶん空ける。詰めると題字の続きとして読まれる
        marginTop: "1.1rem",
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
