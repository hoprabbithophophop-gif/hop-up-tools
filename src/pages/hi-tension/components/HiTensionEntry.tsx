import { useRef, useState } from "react";
import { UNIT_ROWS, NEW_MEMBERS, findMember, PRACTICE_VIDEOS } from "../data";
import HandIcon from "./HandIcon";
import FaIcon from "./FaIcon";
import { faHandPointer } from "@fortawesome/free-solid-svg-icons";
import type { SpecialEvent } from "../events";

// YouTube の規約対応で入口を作り直した版。動画そのものはページ側が常に一番上に出していて、
// 視聴者は YouTube 本体の再生ボタンで始める。ここは「動画の下の帯」に入る、状態を持たない
// 見た目だけの部品（選んだ色は親が持ち、選ぶたびに onPickColor で親に伝える）。
// 色選び・背景✋・QA隠しジェスチャーの作りは components/MemberSelect.tsx から丸ごと移した。
// 「はじめる」ボタンと合言葉の部屋（ROOM_ENABLED=false で非表示）は移していない
// ＝再生は動画側のボタンで始まる前提のため、この部品には「押すと始まる」要素を置かない。

interface Props {
  /** 選んでいる色（メンバーID）。親が持つ状態で、ここではただ表示するだけ。 */
  selectedId: string | null;
  /** 色の丸をタップした時に親へ伝える。 */
  onPickColor: (id: string) => void;
  events?: readonly SpecialEvent[];
  selectedEventKey?: string | null;
  /** 右上にあった表示設定の歯車。今回はタイトル行の中に置く。 */
  onOpenSettings?: () => void;
  /** QAモードのトグル（隠しジェスチャー成立時に呼ぶ）。 */
  onToggleQa?: () => void;
  /** 上級編（振り練習）へ移動する。アイコンのみの控えめな導線。 */
  onOpenAdvanced?: () => void;
  /** 横向きか。今回は縦持ちと同じ並びのままなので、色の丸の並べ方以外には使わない。 */
  isLandscape: boolean;
}

export default function HiTensionEntry({
  selectedId,
  onPickColor,
  events = [],
  selectedEventKey = null,
  onOpenSettings,
  onToggleQa,
  onOpenAdvanced,
  isLandscape,
}: Props) {
  // 色タップごとに +1。背景✋の key に混ぜて「同じ色を選び直しても」再マウント→ポップさせる。
  // 選択そのものは親の state（selectedId）なので、これは見た目の演出だけのローカル state。
  const [popTick, setPopTick] = useState(0);

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

  // 色の丸を押した時の共通処理：選択を親に伝える → ポップ演出 → QAジェスチャー判定。
  const handlePickColor = (id: string) => {
    onPickColor(id);
    setPopTick((t) => t + 1);
    detectQaGesture(id);
  };

  // 表示中のスペシャル回（お祝い等）。選ばれていれば入口の色・文言をその回仕様にする。
  const selectedEvent = events.find((e) => e.key === selectedEventKey) ?? null;
  const isSpecial = selectedEvent != null;
  const eventColor = selectedEvent?.color ?? null;
  // 選択中のメンバーカラー。背景の✋モチーフの着色に使う。スペシャル回中は回の色に統一。
  const selectedColor = isSpecial ? eventColor : (findMember(selectedId)?.color ?? null);
  // 各スウォッチ/アクセントの表示色（配置はそのまま、見た目だけ統一）。
  const tint = (c: string) => (isSpecial && eventColor ? eventColor : c);

  return (
    <div
      style={{
        // 動画の下の帯を埋める器。親（動画の下の flex:1 コンテナ）の中に丸ごと入る想定で、
        // position:fixed や height:100dvh にはしない＝動画の上に覆いかぶさらない。
        position: "relative",
        width: "100%",
        height: "100%",
        // 帯の高さに入りきらない端末向け：この中だけ縦にスクロールできるようにする。
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        // 背景は塗らない：親（動画の下の flex:1 コンテナ）がすでに本編と同じ ARENA_BG を
        // 敷いている前提（HiTensionPage.tsx の play-area / 旧 select 画面のオーバーレイ、
        // どちらも ARENA_BG を敷いている）。ここで重ねて塗ると二重になる。
        color: "#e8eaed",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: isLandscape ? "0.7rem 1rem 0.7rem" : "1.5rem 1.2rem 1.5rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
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

      {/* 版の札。分岐プレビュー・手元だけ右下に出す（本番には出ない）。
          【仮】オーナーに確認中：帯がスクロールする場合ここも一緒に流れる（常時画面固定ではない）。 */}
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

      {/* タイトル行：見出しと設定の歯車を同じ行に。歯車は動画の上ではなくこの帯の中に置く。 */}
      <div
        style={{
          position: "relative",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(1.3rem, 6.5vw, 1.6rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
            textAlign: "center",
            color: "#f5f7fa",
            lineHeight: 1.2,
          }}
        >
          ハイ！テンション
        </h1>
        {onOpenSettings && (
          <button
            type="button"
            aria-label="表示設定"
            onClick={onOpenSettings}
            style={{
              position: "absolute",
              right: 0,
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
      </div>

      <p
        style={{
          // 元は 0.8125rem(13px)。帯全体の「14px以上」ルールに合わせて引き上げ。
          fontSize: "0.875rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          margin: "0.3rem 0 0",
          textAlign: "center",
          color: "#aab0b6",
        }}
      >
        ✋ Practice ver.
      </p>
      {/* 副題の行は通常/スペシャルで常に確保（高さ固定）＝切替時に背景✋が上下しない。
          元は 0.75rem(12px)。文言・色の決まりは MemberSelect と同じ、フォントサイズだけ14px以上に引き上げ。 */}
      <p
        style={{
          fontSize: "0.875rem",
          fontWeight: 700,
          letterSpacing: "0.02em",
          margin: "0.25rem 0 0",
          minHeight: "1.2rem",
          textAlign: "center",
          color: eventColor ?? "#777",
        }}
      >
        {isSpecial ? `〜${selectedEvent.title}〜` : ""}
      </p>

      {/* 中央：背景の✋モチーフに重ねて、色選択を縦中央に置く。
          【仮】横画面の並べ方はオーナーに確認中：今回は縦持ちと同じ並びのままにしてある。
          色の丸を1列に詰める部分（isLandscape 分岐）だけは MemberSelect からそのまま移した。 */}
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
            // 暗背景では色を「重ねる」とくすむので screen 合成で「足して光らせる」。
            // 選んだ色がダークアリーナにそのまま発色する（hop指定: 鮮やかに）。
            mixBlendMode: "screen",
            opacity: selectedColor ? 0.7 : 0.13,
            pointerEvents: "none",
            zIndex: -1,
            animation: "hi-tension-hand-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <HandIcon size="min(122vw, 84vh)" color={selectedColor ?? (isSpecial && eventColor ? eventColor : "#cfd6de")} />
        </div>

        <p
          style={{
            fontSize: "0.95rem",
            fontWeight: 500,
            margin: isLandscape ? "0 0 0.6rem" : "0 0 1rem",
            textAlign: "center",
            color: "#c6ccd2",
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
          // スペシャル回は色選択をまとめる：主役1人として参加（memberId=主役のid）。通常は選んだ色のメンバー。
          // タップで背景✋がポップ（通常の色選び直しと同じ手触り）。選択自体はスペシャル回で固定済みなので
          // onPickColor は呼ばない（MemberSelect と同じ挙動）。
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
          <>
          {/* 横向きは全員を1列に（縦の3段だと低い画面で収まらない）。 */}
          {(isLandscape
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
                    onClick={() => handlePickColor(m.id)}
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
          {/* 2026-06-13 加入の新メンバー3人（最下段に独立した1行） */}
          <div
            style={{
              display: "flex",
              gap: isLandscape ? "0.5rem" : "1rem",
              justifyContent: "center",
              flexWrap: "nowrap",
            }}
          >
            {NEW_MEMBERS.map((m) => {
              const isSelected = selectedId === m.id;
              const baseSize = isLandscape ? "clamp(44px, 14dvh, 52px)" : "clamp(44px, 7.5dvh, 56px)";
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`color ${m.color}`}
                  aria-pressed={isSelected}
                  onClick={() => handlePickColor(m.id)}
                  style={{
                    width: baseSize,
                    height: baseSize,
                    borderRadius: "50%",
                    background: tint(m.color),
                    border: "none",
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
          </>
        )}
        </div>
      </div>

      {/* 誘いの一言。ボタンには見せない＝箱・下線・cursor:pointer・onClick を持たせない素の文。
          押しても何も起きない（始まるのは動画側の再生ボタンから）。 */}
      <p
        style={{
          fontSize: "1rem", // 16px以上
          fontWeight: 700,
          margin: "0.6rem 0 0",
          textAlign: "center",
          color: "#f5f7fa",
          lineHeight: 1.5,
          position: "relative",
          zIndex: 1,
        }}
      >
        {selectedEvent?.enterLabel ?? "みんな、幸せになりたいか～！？"}
      </p>

      {/* 公式動画リンクと、上級編（振り練習）へのアイコンを同じ行に並べる。
          見た目（アイコン単体の控えめなボタン、リンクの下線）は元のまま、位置だけ同じ行へ寄せた。 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "0.6rem",
          flexWrap: "wrap",
          marginTop: "0.6rem",
        }}
      >
        {onOpenAdvanced && (
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
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "0.55rem",
            flexWrap: "wrap",
            // 元は 0.6875rem(11px)。帯全体の「14px以上」ルールに合わせて引き上げ。
            fontSize: "0.875rem",
            color: "#9aa0a6",
          }}
        >
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
    </div>
  );
}
