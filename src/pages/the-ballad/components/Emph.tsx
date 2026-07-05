import { C } from "../ui";
import { MEMBER_COLOR } from "@/data/the-ballad";

// メンバーカラーが白/ほぼ白だと色ブロックが白背景に埋もれる。公式サイト同様に薄グレー枠(#cfd8dc)で縁取り視認できるようにする。
export function isNearWhite(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 235;
}

// 頭文字を big・残りを small で表示（big===small なら均一サイズ）。頭文字でスキャンしやすく全文は残す。
// color が指定されれば、頭文字の背後に左上へズラしたメンバーカラーのベタ塗りブロックを敷く。白系は薄グレー枠。
export function Emph({
  text,
  big,
  small,
  color,
  weight,
  inkColor = C.ink,
}: {
  text: string;
  big: string;
  small: string;
  color?: string;
  weight?: number;
  inkColor?: string;
}) {
  const chars = Array.from(text);
  if (chars.length === 0) return null;
  const whiteish = !!color && isNearWhite(color);
  return (
    <>
      {color ? (
        <span style={{ position: "relative", display: "inline-block", fontSize: big, fontWeight: weight, color: inkColor, marginLeft: "0.22em" }}>
          <span aria-hidden style={{ position: "absolute", left: "-0.22em", top: "-0.06em", width: "0.66em", height: "0.66em", background: color, border: whiteish ? "1px solid #cfd8dc" : undefined, boxSizing: "border-box", zIndex: 0 }} />
          <span style={{ position: "relative", zIndex: 1 }}>{chars[0]}</span>
        </span>
      ) : (
        <span style={{ fontSize: big, fontWeight: weight }}>{chars[0]}</span>
      )}
      {chars.length > 1 && <span style={{ fontSize: small, fontWeight: weight }}>{chars.slice(1).join("")}</span>}
    </>
  );
}

// メンバー名を Emph で表示し、MEMBER_COLOR から色を引く。
// "×" 区切りのデュエット（高木紗友希×小田さくら 等）は各メンバーの色を個別に付ける
// （単色では2人分の色を表せないため）。単独名は従来どおり頭文字1つに着色。
export function MemberEmph({
  member,
  big,
  small,
  weight,
  inkColor = C.ink,
}: {
  member: string;
  big: string;
  small: string;
  weight?: number;
  inkColor?: string;
}) {
  const parts = member.split(/[×✕]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return <Emph text={member} big={big} small={small} weight={weight} color={MEMBER_COLOR[member] || undefined} inkColor={inkColor} />;
  }
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span style={{ fontSize: small, fontWeight: weight, color: inkColor, margin: "0 0.15em" }}>×</span>}
          <Emph text={p} big={big} small={small} weight={weight} color={MEMBER_COLOR[p] || undefined} inkColor={inkColor} />
        </span>
      ))}
    </>
  );
}
