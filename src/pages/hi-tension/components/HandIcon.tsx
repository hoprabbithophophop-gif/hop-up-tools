// FontAwesome Free Solid "hand" icon (CC BY 4.0)
// 帰属表示はフッターで実施
import { faHand } from "@fortawesome/free-solid-svg-icons";

interface Props {
  /** px 数値、または "min(118vw, 82vh)" のような CSS 長さ文字列 */
  size: number | string;
  color: string;
}

export default function HandIcon({ size, color }: Props) {
  const [w, h, , , pathData] = faHand.icon;
  const path = Array.isArray(pathData) ? pathData.join(" ") : pathData;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d={path} fill={color} />
    </svg>
  );
}
