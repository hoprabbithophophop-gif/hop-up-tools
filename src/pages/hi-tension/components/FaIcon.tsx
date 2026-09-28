// FontAwesome Free Solid アイコンを SVG で描く汎用コンポーネント（CC BY 4.0・帰属はフッター）。
// HandIcon と同じ仕組みを「任意のアイコン定義を渡せる」形に一般化したもの。
// 使い方: <FaIcon icon={faBullhorn} size={36} color="#191c1d" />

// fontawesome のアイコン定義のうち、ここで使う形だけを最小で型付け（型パッケージに依存しない）。
type FaDef = { icon: [number, number, unknown, unknown, string | string[]] };

interface Props {
  /** @fortawesome/free-solid-svg-icons の faXxx をそのまま渡す */
  icon: FaDef;
  /** px 数値、または "min(118vw, 82vh)" のような CSS 長さ文字列 */
  size: number | string;
  color: string;
}

export default function FaIcon({ icon, size, color }: Props) {
  const [w, h, , , pathData] = icon.icon;
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
