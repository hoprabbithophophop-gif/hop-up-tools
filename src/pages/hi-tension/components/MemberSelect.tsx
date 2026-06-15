import { useState, useEffect, useRef } from "react";
import { UNIT_ROWS, findMember, PRACTICE_VIDEOS } from "../data";
import HandIcon from "./HandIcon";
import FaIcon from "./FaIcon";
import { faHandPointer } from "@fortawesome/free-solid-svg-icons";
import type { SpecialEvent } from "../events";

// 合言葉の部屋（リアルタイム同期）は実利用がほぼ無く（YouTube同期の制約で2人まで）入口を非表示に。
// コードは温存（useHiTensionRealtime / room-menu / waiting / ready-check）＝復活可。完全撤去は別タスク。
const ROOM_ENABLED = false;

interface Props {
  initialSelectedId: string | null;
  onConfirm: (memberId: string) => void;
  onOpenRoomMenu: (memberId: string) => void;
  events?: readonly SpecialEvent[];
  viewOnly?: boolean;
  selectedEventKey?: string | null;
  onOpenSettings?: () => void;
  /** QAモードのトグル（隠しジェスチャー成立時に呼ぶ）。 */
  onToggleQa?: () => void;
  /** 上級編（振り練習）へ移動する。アイコンのみの控えめな導線。 */
  onOpenAdvanced?: () => void;
}

export default function MemberSelect({
  initialSelectedId,
  onConfirm,
  onOpenRoomMenu,
  events = [],
  viewOnly = false,
  selectedEventKey = null,
  onOpenSettings,
  onToggleQa,
  onOpenAdvanced,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // 色タップごとに +1。背景✋の key に混ぜて「同じ色を選び直しても」再マウント→ポップさせる。
  const [popTick, setPopTick] = useState(0);
  // 横向き（landscape）。縦の「ユニット3段」だと低い画面に収まらず「はじめる」が押せないため、
  // 横の時は色◯を全員横一列に並べ替え、余白も詰める（本編の横アリと同じ matchMedia 検知）。
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    try { return window.matchMedia("(orientation: landscape)").matches; } catch { return false; }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(orientation: landscape)"); } catch { return; }
    const onChange = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.title = "ハイ！テンション✋ Practice ver. | hop-up-tools";
  }, []);

  // QAモード起動の隠しジェスチャー（hop指定）：nishida⇄eguchi の色を5秒以内に10往復（交互20タップ）。
  // 実機でURLにパラメータを打つのが面倒なため。成立でトグル（もう一度で解除）。保存はしない。
  const qaTapsRef = useRef<{ id: string; t: number }[]>([]);
  const detectQaGesture = (id: string) => {
    if (id !== "nishida" && id !== "eguchi") {
      qaTapsRef.current = []; // 別の色を押したら仕切り直し
      return;
    }
    const now = performance.now();
    const taps = qaTapsRef.current;
    const last = taps[taps.length - 1];
    if (last && last.id === id) {
      qaTapsRef.current = [{ id, t: now }]; // 交互でなければこのタップから数え直し
      return;
    }
    taps.push({ id, t: now });
    while (taps.length > 0 && now - taps[0].t > 5000) taps.shift(); // 5秒窓の外は捨てる
    if (taps.length >= 20) {
      qaTapsRef.current = [];
      onToggleQa?.();
    }
  };

  // 表示中のスペシャル回（お祝い等）。選ばれていれば入口の色・文言をその回仕様にする。
  const selectedEvent = events.find((e) => e.key === selectedEventKey) ?? null;
  const isSpecial = selectedEvent != null;
  const eventColor = selectedEvent?.color ?? null;
  // 選択中のメンバーカラー。背景の✋モチーフの着色に使う。スペシャル回中は回の色に統一。
  const selectedColor = isSpecial ? eventColor : (findMember(selectedId)?.color ?? null);
  // 各スウォッチ/アクセントの表示色（配置はそのまま、見た目だけ統一）。
  const tint = (c: string) => (isSpecial && eventColor ? eventColor : c);
  // スペシャル回は色選択をまとめる：主役1人として参加（memberId=主役のid）。通常は選んだ色のメンバー。
  const specialMemberId = selectedEvent?.targetMemberId ?? null;
  const effectiveSelectedId = isSpecial ? specialMemberId : selectedId;

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
        // 横向きは縦が約320pxしかない（iPhone SE横）ので上下余白を詰めて全要素を収める。
        padding: isLandscape ? "0.7rem 1rem 0.7rem" : "1.5rem 1.2rem 1.5rem",
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

      {/* 表示設定を開く歯車。右上に控えめに（背景✋より前面）。 */}
      {onOpenSettings && (
        <button
          type="button"
          aria-label="表示設定"
          onClick={onOpenSettings}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 2,
            background: "none",
            border: "none",
            fontSize: "1.25rem",
            lineHeight: 1,
            color: "#9aa0a6",
            cursor: "pointer",
            padding: "0.3rem",
          }}
        >
          ⚙
        </button>
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
      {/* 副題の行は通常/スペシャルで常に確保（高さ固定）＝切替時に背景✋が上下しない。 */}
      <p
        style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.02em",
          margin: "0.25rem 0 0",
          minHeight: "1.05rem",
          textAlign: "center",
          color: eventColor ?? "#777",
        }}
      >
        {isSpecial ? `〜${selectedEvent.title}〜` : ""}
      </p>

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
          key={`${selectedId ?? "none"}-${popTick}`}
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
          <HandIcon size="min(122vw, 84vh)" color={selectedColor ?? (isSpecial && eventColor ? eventColor : "#000")} />
        </div>

        <p
          style={{
            fontSize: "0.95rem",
            fontWeight: 500,
            margin: isLandscape ? "0 0 0.6rem" : "0 0 1rem",
            textAlign: "center",
            color: "#474747",
            position: "relative",
            zIndex: 1,
          }}
        >
          {isSpecial ? "好きな色だよね？" : "好きな色は？"}
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.8rem",
            alignItems: "center",
            width: "100%",
            // 横向きは9個1列ぶんの幅（≈9×52+gap）を許容する
            maxWidth: isLandscape ? 560 : 360,
            position: "relative",
            zIndex: 1,
          }}
        >
        {isSpecial ? (
          // スペシャル回は色選択をまとめる：主役色1個だけ中央に（全員その回の主役として参加）。
          // タップで背景✋がポップ（通常の色選び直しと同じ手触り）。
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              aria-label="主役の色"
              onClick={() => setPopTick((t) => t + 1)}
              style={{
                width: "clamp(56px, 10dvh, 72px)",
                height: "clamp(56px, 10dvh, 72px)",
                borderRadius: "50%",
                background: eventColor ?? "#000",
                border: "none",
                padding: 0,
                cursor: "pointer",
                boxShadow: `0 0 0 3px #f8f9fa, 0 0 0 5px ${eventColor ?? "#000"}`,
              }}
            />
          </div>
        ) : (
          // 横向きは全員を1列に（縦の3段だと低い画面で「はじめる」が画面外に出て押せない）。
          (isLandscape
            ? [{ unit: "all", members: UNIT_ROWS.flatMap((r) => r.members) }]
            : UNIT_ROWS
          ).map((row) => (
            <div
              key={row.unit}
              style={{
                display: "flex",
                gap: isLandscape ? "0.5rem" : "1rem",
                justifyContent: "center",
                flexWrap: "nowrap",
              }}
            >
              {row.members.map((m) => {
                const isSelected = selectedId === m.id;
                // 画面の高さに応じて 44〜56px の範囲で自動調整。
                // 大画面では押しやすい 56px、iPhone SE 1st gen 等では HIG 最低の 44px。
                // 横向きは9個が1列に収まるよう少し小さめ上限（44〜52px）。
                const baseSize = isLandscape ? "clamp(44px, 14dvh, 52px)" : "clamp(44px, 7.5dvh, 56px)";
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-label={`color ${m.color}`}
                    aria-pressed={isSelected}
                    onClick={() => { setSelectedId(m.id); setPopTick((t) => t + 1); detectQaGesture(m.id); }}
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
          ))
        )}
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
          disabled={!effectiveSelectedId}
          onClick={() => effectiveSelectedId && onConfirm(effectiveSelectedId)}
          style={{
            width: "100%",
            padding: "1rem",
            background: effectiveSelectedId ? "#000" : "#c6c6c6",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: effectiveSelectedId ? "pointer" : "not-allowed",
            transition: "background 0.12s",
          }}
        >
          {isSpecial ? (viewOnly ? "盛り上がりを見る" : "今こそ手を挙げたい！！！！！") : "はじめる"}
        </button>

        {/* 合言葉の部屋（コードで集まる）。ROOM_ENABLED=false で当面非表示。 */}
        {ROOM_ENABLED && (
          <button
            type="button"
            disabled={!effectiveSelectedId}
            onClick={() => effectiveSelectedId && onOpenRoomMenu(effectiveSelectedId)}
            style={{
              width: "100%",
              padding: "1rem",
              background: effectiveSelectedId ? "#000" : "#c6c6c6",
              color: "#fff",
              border: "none",
              fontSize: "0.875rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: effectiveSelectedId ? "pointer" : "not-allowed",
              transition: "background 0.12s",
            }}
          >
            合言葉の部屋へ
          </button>
        )}

      </div>

      {/* 上級編（振り練習）へ。はじめるの下にアイコンのみで控えめに置く。 */}
      {onOpenAdvanced && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.4rem" }}>
          <button
            type="button"
            aria-label="上級編へ"
            onClick={onOpenAdvanced}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.4rem",
              opacity: 0.85,
              display: "inline-flex",
            }}
          >
            <FaIcon icon={faHandPointer} size={26} color="#9aa0a6" />
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.3rem", fontSize: "0.6875rem", color: "#9aa0a6" }}>
        <span>公式動画</span>
        {PRACTICE_VIDEOS.map((v) => (
          <a
            key={v.id}
            href={`https://youtu.be/${v.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#9aa0a6", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "0.2rem" }}
          >
            ▶ {v.label}
          </a>
        ))}
      </div>

    </div>
  );
}
