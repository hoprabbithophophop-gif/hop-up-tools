import { useState, useEffect } from "react";
import { UNIT_ROWS, findMember } from "../data";
import HandIcon from "./HandIcon";
import { NISHIDA_COLOR } from "../birthday";

interface Props {
  initialSelectedId: string | null;
  onConfirm: (memberId: string) => void;
  onOpenRoomMenu: (memberId: string) => void;
  /** 西田汐里さんバースデー開催中か（トグルの表示有無）。 */
  birthdayActive?: boolean;
  /** お祝い表示ON（色をピンクに）。トグルで切替。 */
  birthdayOn?: boolean;
  /** お祝い表示のON/OFF切替。 */
  onToggleBirthday?: () => void;
}

export default function MemberSelect({
  initialSelectedId,
  onConfirm,
  onOpenRoomMenu,
  birthdayActive = false,
  birthdayOn = false,
  onToggleBirthday,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  useEffect(() => {
    document.title = "ハイ！テンション✋ Practice ver. | hop-up-tools";
  }, []);

  // 西田汐里さん バースデースペシャル（6/7）：お祝い表示ONのとき入口の色を全て nishida ピンクに。
  const bday = birthdayOn;
  // 選択中のメンバーカラー。背景の✋モチーフの着色に使う。誕生日中は全色 nishida ピンク。
  const selectedColor = bday ? NISHIDA_COLOR : (findMember(selectedId)?.color ?? null);
  // 各スウォッチ/アクセントの表示色（配置はそのまま、見た目だけ統一）。
  const tint = (c: string) => (bday ? NISHIDA_COLOR : c);

  return (
    <div
      style={{
        height: "100dvh", // dvh で動的に viewport に合わせ + overflow hidden で iOS の rubber band も潰す
        overflow: "hidden",
        background: "#f8f9fa",
        color: "#191c1d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "1.5rem 1.2rem 1.5rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        animation: "hi-tension-fade-in 180ms ease-out",
        position: "relative",
        isolation: "isolate", // ✋モチーフ(zIndex:-1)を背景の前・全コンテンツの背面に固定する
      }}
    >
      <style>{`
        /* 本編/待機室の hand-hop と同じ「squash→stretch」の感触。全画面の✋なので
           平行移動はせず、その場で潰れて伸びて戻る（色変更のたびに走る）。 */
        @keyframes hi-tension-hand-pop {
          0%   { transform: translate(-50%, -50%) scaleX(1.06) scaleY(0.9); }
          45%  { transform: translate(-50%, -50%) scaleX(0.97) scaleY(1.05); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
      {__SHOW_VERSION__ && (
        <span
          style={{
            position: "absolute",
            bottom: 4,
            right: 8,
            fontSize: "0.5rem",
            color: "#c6c6c6",
            letterSpacing: "0.02em",
            pointerEvents: "none",
          }}
        >
          v.{__COMMIT_SHA__}
        </span>
      )}

      {/* ヘッダー：メインタイトル＋小さな副題（狭い画面でも折り返さない） */}
      <h1
        style={{
          fontSize: "clamp(1.3rem, 6.5vw, 1.6rem)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: 0,
          textAlign: "center",
          color: "#000",
          lineHeight: 1.2,
        }}
      >
        ハイ！テンション
      </h1>
      <p
        style={{
          fontSize: "0.8125rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          margin: "0.3rem 0 0",
          textAlign: "center",
          color: "#777",
        }}
      >
        ✋ Practice ver.
      </p>
      {bday && (
        <p
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.02em",
            margin: "0.25rem 0 0",
            textAlign: "center",
            color: NISHIDA_COLOR,
          }}
        >
          〜西田汐里さんバースデースペシャル〜
        </p>
      )}
      {birthdayActive && onToggleBirthday && (
        <button
          type="button"
          onClick={onToggleBirthday}
          style={{
            margin: "0.4rem 0 0",
            padding: "0.2rem 0.6rem",
            background: "transparent",
            border: `1px solid ${bday ? "#c6c6c6" : NISHIDA_COLOR}`,
            borderRadius: 999,
            color: bday ? "#777" : NISHIDA_COLOR,
            fontSize: "0.6875rem",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {bday ? "通常の色で表示する" : "🩷 バースデー仕様で表示する"}
        </button>
      )}

      {/* 中央：背景の✋モチーフに重ねて、色選択を縦中央に置く */}
      <div
        style={{
          flex: 1,
          width: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* 背景に画面いっぱいの✋（このツールの核アイコン）。選んだ色で着色して「自分の色の手」を示唆。
            色を変えるたび key が変わって再マウント→小さく跳ねる演出が走る。 */}
        <div
          key={selectedId ?? "none"}
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            opacity: selectedColor ? 0.13 : 0.06,
            pointerEvents: "none",
            zIndex: -1,
            animation: "hi-tension-hand-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <HandIcon size="min(122vw, 84vh)" color={selectedColor ?? (bday ? NISHIDA_COLOR : "#000")} />
        </div>

        <p
          style={{
            fontSize: "0.95rem",
            fontWeight: 500,
            margin: "0 0 1rem",
            textAlign: "center",
            color: "#474747",
            position: "relative",
            zIndex: 1,
          }}
        >
          好きな色は？
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.8rem",
            alignItems: "center",
            width: "100%",
            maxWidth: 360,
            position: "relative",
            zIndex: 1,
          }}
        >
        {UNIT_ROWS.map((row) => (
          <div
            key={row.unit}
            style={{
              display: "flex",
              gap: "1rem",
              justifyContent: "center",
              flexWrap: "nowrap",
            }}
          >
            {row.members.map((m) => {
              const isSelected = selectedId === m.id;
              // 画面の高さに応じて 44〜56px の範囲で自動調整。
              // 大画面では押しやすい 56px、iPhone SE 1st gen 等では HIG 最低の 44px。
              const baseSize = "clamp(44px, 7.5dvh, 56px)";
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`color ${m.color}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(m.id)}
                  style={{
                    // 選択時は transform: scale で拡大するだけなので、
                    // 行の高さも他の丸の位置も動かない。
                    width: baseSize,
                    height: baseSize,
                    borderRadius: "50%",
                    background: tint(m.color),
                    border: "none",
                    // リングは box-shadow(レイアウトに影響しない)で表現
                    boxShadow: isSelected
                      ? `0 0 0 3px #f8f9fa, 0 0 0 5px ${tint(m.color)}`
                      : "0 0 0 1px rgba(0,0,0,0.08)",
                    padding: 0,
                    cursor: "pointer",
                    transform: isSelected ? "scale(1.2)" : "scale(1)",
                    transition: "transform 0.18s, box-shadow 0.18s",
                  }}
                />
              );
            })}
          </div>
        ))}
        </div>
      </div>

      <div
        style={{
          marginBottom: "0.5rem",
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
        }}
      >
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => selectedId && onConfirm(selectedId)}
          style={{
            width: "100%",
            padding: "1rem",
            background: selectedId ? "#000" : "#c6c6c6",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: selectedId ? "pointer" : "not-allowed",
            transition: "background 0.12s",
          }}
        >
          {bday ? "今こそ手を挙げたい" : "ひとりではじめる"}
        </button>

        {/* 合言葉の部屋（コードで集まる） */}
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => selectedId && onOpenRoomMenu(selectedId)}
          style={{
            width: "100%",
            padding: "1rem",
            background: selectedId ? "#000" : "#c6c6c6",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: selectedId ? "pointer" : "not-allowed",
            transition: "background 0.12s",
          }}
        >
          合言葉の部屋へ
        </button>
      </div>

    </div>
  );
}
