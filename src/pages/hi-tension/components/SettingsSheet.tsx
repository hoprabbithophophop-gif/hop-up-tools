import type { CSSProperties } from "react";
import type { HiSettings, HiCrowdLevel } from "../storage";
import { DEFAULT_HI_SETTINGS, LIGHT_HI_SETTINGS } from "../storage";

interface Props {
  settings: HiSettings;
  onChange: (next: HiSettings) => void;
  onClose: () => void;
}

// セグメント選択の1択肢。選択中は黒地・白字、未選択は薄いグレー（入口/EndCardのボタン語彙に合わせる）。
function Segment<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { v: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.4rem", width: "100%" }}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(o.v)}
            style={{
              flex: 1,
              padding: "0.6rem 0.3rem",
              border: "none",
              background: active ? "#000" : "#eceef0",
              color: active ? "#fff" : "#474747",
              fontSize: "0.8125rem",
              fontWeight: 700,
              letterSpacing: "0.02em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const rowLabelStyle: CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 700,
  color: "#191c1d",
  margin: "0 0 0.45rem",
};
const rowHintStyle: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 500,
  color: "#777",
  margin: "0.35rem 0 0",
  lineHeight: 1.4,
};

/**
 * 表示設定シート（ユーザー任意のopt-in）。入口の歯車から開く。
 * 「かるくする/標準」プリセット＋詳細3項目（群衆量・盛り上がり・動き）を全部同じ画面に出す。
 * 既定（標準）は今までの見え方そのまま。設定は localStorage に保存される（呼び出し側で永続化）。
 */
export default function SettingsSheet({ settings, onChange, onClose }: Props) {
  const set = (patch: Partial<HiSettings>) => onChange({ ...settings, ...patch });
  const isLight =
    settings.crowd === LIGHT_HI_SETTINGS.crowd &&
    settings.heatmap === LIGHT_HI_SETTINGS.heatmap &&
    settings.reduceMotion === LIGHT_HI_SETTINGS.reduceMotion;
  const isDefault =
    settings.crowd === DEFAULT_HI_SETTINGS.crowd &&
    settings.heatmap === DEFAULT_HI_SETTINGS.heatmap &&
    settings.reduceMotion === DEFAULT_HI_SETTINGS.reduceMotion;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="表示設定"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.2rem",
        animation: "hi-tension-fade-in 160ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 340,
          maxHeight: "88dvh",
          overflowY: "auto",
          background: "#f8f9fa",
          color: "#191c1d",
          padding: "1.3rem 1.3rem 1.1rem",
          fontFamily: "Inter, 'Noto Sans JP', sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: "1.15rem",
        }}
      >
        {/* ヘッダー */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 800, margin: 0, letterSpacing: "0.02em" }}>
            表示設定
          </h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.1rem",
              lineHeight: 1,
              color: "#777",
              cursor: "pointer",
              padding: "0.2rem",
            }}
          >
            ✕
          </button>
        </div>

        {/* プリセット */}
        <div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              type="button"
              aria-pressed={isLight}
              onClick={() => onChange({ ...LIGHT_HI_SETTINGS })}
              style={{
                flex: 1,
                padding: "0.7rem 0.3rem",
                border: "none",
                background: isLight ? "#000" : "#eceef0",
                color: isLight ? "#fff" : "#191c1d",
                fontSize: "0.8125rem",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              かるくする
            </button>
            <button
              type="button"
              aria-pressed={isDefault}
              onClick={() => onChange({ ...DEFAULT_HI_SETTINGS })}
              style={{
                flex: 1,
                padding: "0.7rem 0.3rem",
                border: "none",
                background: isDefault ? "#000" : "#eceef0",
                color: isDefault ? "#fff" : "#191c1d",
                fontSize: "0.8125rem",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              標準
            </button>
          </div>
          <p style={rowHintStyle}>重い端末は「かるくする」だけでOK。下で個別に調整もできる。</p>
        </div>

        {/* 群衆の✋ */}
        <div>
          <p style={rowLabelStyle}>群衆の✋</p>
          <Segment<HiCrowdLevel>
            options={[
              { v: "full", label: "満員" },
              { v: "light", label: "控えめ" },
              { v: "self", label: "自分だけ" },
            ]}
            value={settings.crowd}
            onSelect={(v) => set({ crowd: v })}
          />
          <p style={rowHintStyle}>
            {settings.crowd === "self"
              ? "みんなの✋を出さず、自分だけでイメトレ。"
              : settings.crowd === "light"
                ? "✋を控えめにして軽く。"
                : "みんなの✋を満員で表示。"}
          </p>
        </div>

        {/* 盛り上がりタイムライン */}
        <div>
          <p style={rowLabelStyle}>盛り上がりタイムライン</p>
          <Segment<"on" | "off">
            options={[
              { v: "on", label: "表示" },
              { v: "off", label: "非表示" },
            ]}
            value={settings.heatmap ? "on" : "off"}
            onSelect={(v) => set({ heatmap: v === "on" })}
          />
        </div>

        {/* 動き */}
        <div>
          <p style={rowLabelStyle}>動き</p>
          <Segment<"normal" | "reduce">
            options={[
              { v: "normal", label: "通常" },
              { v: "reduce", label: "減らす" },
            ]}
            value={settings.reduceMotion ? "reduce" : "normal"}
            onSelect={(v) => set({ reduceMotion: v === "reduce" })}
          />
          <p style={rowHintStyle}>✋の跳ねる動きを抑える（軽量・酔い対策）。</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "0.85rem",
            border: "none",
            background: "#000",
            color: "#fff",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "inherit",
            marginTop: "0.2rem",
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
