// 表示設定シート。ハイ！テンションの設定シート(SettingsSheet)と同じ見た目・同じ語彙で、
// 💎に関係する項目だけ（みんなの💎の量・動き）。入口の歯車から開く。
import type { CSSProperties } from "react";

export type DiamondCrowdLevel = "full" | "light" | "self";
/** 再生中の色えらびの並べ方。pages=ユニットごとのページ / row=一列の帯（Hop決定 2026-09-08） */
export type DiamondColorLayout = "pages" | "row";
export type DiamondSettings = {
  /** みんなの💎の量。full=全部 / light=控えめ / self=自分だけ */
  crowd: DiamondCrowdLevel;
  /** 回転と瞬きを止める（軽量・酔い対策） */
  reduceMotion: boolean;
  /** 色えらびの並べ方。既定はユニットごとのページ */
  colorLayout: DiamondColorLayout;
  /** 💎の見せ方。実機で見比べた結果ミラーボールだけにした（Hop決定 2026-09-08）。設定からは選べない。山の描画はキャンバス側に残してある */
  scene: DiamondScene;
};
export type DiamondScene = "pile" | "mirrorball";
export const DEFAULT_DIAMOND_SETTINGS: DiamondSettings = { crowd: "full", reduceMotion: false, colorLayout: "pages", scene: "mirrorball" };
export const LIGHT_DIAMOND_SETTINGS: DiamondSettings = { crowd: "light", reduceMotion: true, colorLayout: "pages", scene: "mirrorball" };

const KEY = "hai_to_diamond:settings";
export function getDiamondSettings(): DiamondSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_DIAMOND_SETTINGS };
    const p = JSON.parse(raw) as Partial<DiamondSettings>;
    return {
      crowd: p.crowd === "light" || p.crowd === "self" ? p.crowd : "full",
      reduceMotion: p.reduceMotion === true,
      // 前からこの端末に残っている覚え書きには「色の並び」が無い。その時はユニットごと（既定）にする
      colorLayout: p.colorLayout === "row" ? "row" : "pages",
      scene: "mirrorball",   // 山は選べなくした。前の覚え書きに pile が残っていても無視する
    };
  } catch {
    return { ...DEFAULT_DIAMOND_SETTINGS };
  }
}
export function setDiamondSettings(s: DiamondSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function Segment<T extends string>({ options, value, onSelect }: { options: { v: T; label: string }[]; value: T; onSelect: (v: T) => void }) {
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

const rowLabelStyle: CSSProperties = { fontSize: "0.8125rem", fontWeight: 700, color: "#191c1d", margin: "0 0 0.45rem" };
const rowHintStyle: CSSProperties = { fontSize: "0.75rem", fontWeight: 500, color: "#777", margin: "0.35rem 0 0", lineHeight: 1.4 };
const dividerStyle: CSSProperties = { height: 1, background: "#e3e6e8", margin: "0.1rem 0" };

interface Props {
  settings: DiamondSettings;
  onChange: (next: DiamondSettings) => void;
  onClose: () => void;
}

export default function DiamondSettingsSheet({ settings, onChange, onClose }: Props) {
  const isLight = settings.crowd === LIGHT_DIAMOND_SETTINGS.crowd && settings.reduceMotion === LIGHT_DIAMOND_SETTINGS.reduceMotion;
  const isDefault = settings.crowd === DEFAULT_DIAMOND_SETTINGS.crowd && settings.reduceMotion === DEFAULT_DIAMOND_SETTINGS.reduceMotion;
  const presetBtn = (active: boolean): CSSProperties => ({
    flex: 1, padding: "0.7rem 0.3rem", border: "none", background: active ? "#000" : "#eceef0", color: active ? "#fff" : "#191c1d",
    fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="設定"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.2rem" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 340, maxHeight: "88dvh", overflowY: "auto", background: "#f8f9fa", color: "#191c1d", padding: "1.3rem 1.3rem 1.1rem", fontFamily: "Inter, 'Noto Sans JP', sans-serif", display: "flex", flexDirection: "column", gap: "1.15rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 800, margin: 0, letterSpacing: "0.02em" }}>設定</h2>
          <button type="button" aria-label="閉じる" onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.1rem", lineHeight: 1, color: "#777", cursor: "pointer", padding: "0.2rem" }}>✕</button>
        </div>

        <div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {/* まとめて切り替える2つのボタンでは「色の並び」は動かさない（選んだ並べ方が黙って戻るのを防ぐ） */}
            <button type="button" aria-pressed={isLight} onClick={() => onChange({ ...LIGHT_DIAMOND_SETTINGS, colorLayout: settings.colorLayout, scene: settings.scene })} style={presetBtn(isLight)}>かるくする</button>
            <button type="button" aria-pressed={isDefault} onClick={() => onChange({ ...DEFAULT_DIAMOND_SETTINGS, colorLayout: settings.colorLayout, scene: settings.scene })} style={presetBtn(isDefault)}>標準</button>
          </div>
          <p style={rowHintStyle}>重い端末は「かるくする」だけでOK。下で個別に調整もできる。</p>
        </div>

        <div style={dividerStyle} />

        <div>
          <p style={rowLabelStyle}>みんなの💎</p>
          <Segment
            options={[{ v: "full", label: "全部" }, { v: "light", label: "控えめ" }, { v: "self", label: "自分だけ" }]}
            value={settings.crowd}
            onSelect={(v) => onChange({ ...settings, crowd: v })}
          />
          <p style={rowHintStyle}>
            {settings.crowd === "self" ? "みんなの💎を出さず、自分の💎だけ。" : settings.crowd === "light" ? "みんなの💎を控えめにして軽く。" : "みんなの💎を全部表示。"}
          </p>
        </div>

        <div style={dividerStyle} />

        <div>
          <p style={rowLabelStyle}>動き</p>
          <Segment
            options={[{ v: "normal", label: "通常" }, { v: "reduce", label: "減らす" }]}
            value={settings.reduceMotion ? "reduce" : "normal"}
            onSelect={(v) => onChange({ ...settings, reduceMotion: v === "reduce" })}
          />
          <p style={rowHintStyle}>💎の回転と瞬きを抑える（軽量・酔い対策）。</p>
        </div>

        <div style={dividerStyle} />

        <div>
          <p style={rowLabelStyle}>色の並び</p>
          <Segment
            options={[{ v: "pages", label: "ユニットごと" }, { v: "row", label: "一列" }]}
            value={settings.colorLayout}
            onSelect={(v) => onChange({ ...settings, colorLayout: v })}
          />
        </div>


        <button
          type="button"
          onClick={onClose}
          style={{ width: "100%", padding: "0.85rem", border: "none", background: "#000", color: "#fff", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
