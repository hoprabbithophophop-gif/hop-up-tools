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
    <>
      <style>{`
        /* 本編/待機室の hand-hop と同じ「squash→stretch」の感触。全画面の✋なので
           平行移動はせず、その場で潰れて伸びて戻る（色変更のたびに走る）。 */
        @keyframes hi-tension-hand-pop {
          0%   { transform: translate(-50%, -50%) scaleX(1.06) scaleY(0.9); }
          45%  { transform: translate(-50%, -50%) scaleX(0.97) scaleY(1.05); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }

        /* なぞる器(.hi-entry-scroll)自身の矩形を、帯の高さに固定した「物差し」にする。
           これで cqh は中身がどれだけ膨らんでも帯の見えている高さのまま動かない。 */
        .hi-entry-scroll {
          container-type: size;
        }

        /* 中身の箱。✋も中身もここでまとめて切る＝✋のはみ出しは見えなくなるだけで、
           なぞれる範囲（なぞる器のスクロール量）を広げない。overflow:clip 未対応環境向けに
           overflow:hidden を先に書いておき、後勝ちで clip に上書きさせる。 */
        .hi-entry-inner {
          overflow: hidden;
          overflow: clip;
        }

        /* 帯の上下の余白。上：古いエンジン向けの元の固定値→次点でcqh。cqh非対応なら固定値のまま。 */
        .hi-entry-pad {
          padding: 1.5rem 1.2rem 1.5rem;
          padding: clamp(0.5rem, 5cqh, 1.5rem) 1.2rem clamp(0.5rem, 5cqh, 1.5rem);
        }
        .hi-entry-pad-landscape {
          padding: 0.7rem 1rem 0.7rem;
          padding: clamp(0.4rem, 4cqh, 0.7rem) 1rem clamp(0.4rem, 4cqh, 0.7rem);
        }

        /* 色の丸の段と段の間隔。0.6rem を下限にしているのは、選択中の丸が
           scale(1.2)+リング(box-shadow 5px)で膨らむ分（実測で片側約9.4px）を
           隣の段と重ねないため。 */
        .hi-color-rows {
          gap: 0.8rem;
          gap: clamp(0.6rem, 3cqh, 0.8rem);
        }
        /* 丸と丸の間隔（縦持ちの同じ段の中）。段間隔と同じ理由で下限0.6rem。 */
        .hi-color-row {
          gap: 1rem;
          gap: clamp(0.6rem, 3cqh, 1rem);
        }

        /* 色の丸の直径。3段構え：①どのエンジンでも通る素の44px ②旧来のdvh基準の式
           ③帯の高さ基準のcqhの式（後勝ちなので、対応エンジンほど後の式が効く）。 */
        .hi-color-circle {
          width: 44px;
          width: clamp(44px, 7.5dvh, 56px);
          width: clamp(44px, 13cqh, 56px);
          height: 44px;
          height: clamp(44px, 7.5dvh, 56px);
          height: clamp(44px, 13cqh, 56px);
        }
        .hi-color-circle-landscape {
          width: 44px;
          width: clamp(44px, 14dvh, 52px);
          width: clamp(44px, 13cqh, 52px);
          height: 44px;
          height: clamp(44px, 14dvh, 52px);
          height: clamp(44px, 13cqh, 52px);
        }
        /* スペシャル回の主役1人ぶんの丸（通常より大きめの56〜72px）。 */
        .hi-color-circle-event {
          width: 56px;
          width: clamp(56px, 10dvh, 72px);
          width: clamp(44px, 15cqh, 72px);
          height: 56px;
          height: clamp(56px, 10dvh, 72px);
          height: clamp(44px, 15cqh, 72px);
        }

        /* ここから追加：タイトル周り〜リンク行の上下の余白と行の高さ（line-height）も帯の高さに
           合わせて詰める。フォールバック→cqh の2段構え（丸の直径と違い、こちらはdvh基準の
           旧式が無いのでシンプルに2段）。line-height の下限は1.2em＝文字が上下で切れない目安
           （FaIcon/絵文字/日本語とも、行の高さが文字サイズの1.2倍を割らなければ欠けない）。
           フォールバック値の1.45は、日本語混在時にNoto Sans JPのnormalが1.2よりかなり大きく
           出ることがあるための仮置き（Latin主体の要素は実際はもっと1.2寄りになる想定）。 */
        .hi-subtitle {
          margin: 0.3rem 0 0;
          margin: clamp(0.15rem, 2cqh, 0.3rem) 0 0;
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-special-subtitle {
          margin: 0.25rem 0 0;
          margin: clamp(0.15rem, 2cqh, 0.25rem) 0 0;
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-color-intro {
          margin: 0 0 1rem;
          margin: 0 0 clamp(0.3rem, 4cqh, 1rem);
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-color-intro-landscape {
          margin: 0 0 0.6rem;
          margin: 0 0 clamp(0.3rem, 3cqh, 0.6rem);
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-invite {
          margin: 0.6rem 0 0;
          margin: clamp(0.25rem, 3cqh, 0.6rem) 0 0;
          line-height: 1.5;
          line-height: clamp(1.2em, 6cqh, 1.5em);
        }
        .hi-links-row {
          margin-top: 0.6rem;
          margin-top: clamp(0.25rem, 3cqh, 0.6rem);
        }
        .hi-advanced-btn {
          padding: 0.4rem;
          padding: clamp(0.15rem, 2cqh, 0.4rem);
        }
        .hi-links-text {
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
      `}</style>

      {/* なぞる器。帯より中身が高い端末だけ、ここが縦にスクロールする（横は常に不可）。
          padding はここに置かない＝cqh は「なぞる器」の中身の箱(padding抜きの矩形)基準なので、
          ここに余白を持たせると物差し自体が動いてしまう。余白は内側の .hi-entry-inner 側。 */}
      <div
        className="hi-entry-scroll"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 0,
          overflowX: "hidden",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        {/* 中身の箱。minHeight:100% で「最低でも帯いっぱい」を確保しつつ、中身が収まりきらない
            端末だけ自然に content の高さぶん伸びる（＝なぞる器がその差だけスクロール可能になる）。
            ✋は絶対配置で中に居座るだけなので、この伸び縮みには参加しない＝伸びても✋の見え方は
            変わらない。overflow:clip がこの箱の矩形ぴったりで✋と中身の両方を切る。 */}
        <div
          className={`hi-entry-inner ${isLandscape ? "hi-entry-pad-landscape" : "hi-entry-pad"}`}
          style={{
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            color: "#e8eaed",
            fontFamily: "Inter, 'Noto Sans JP', sans-serif",
            isolation: "isolate", // ✋モチーフ(zIndex:-1)を背景の前・全コンテンツの背面に固定する
          }}
        >
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
            className="hi-subtitle"
            style={{
              // 元は 0.8125rem(13px)。帯全体の「14px以上」ルールに合わせて引き上げ。
              fontSize: "0.875rem",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textAlign: "center",
              color: "#aab0b6",
            }}
          >
            ✋ Practice ver.
          </p>
          {/* 副題の行は通常/スペシャルで常に確保（高さ固定）＝切替時に背景✋が上下しない。
              以前は minHeight で固定していたが、line-height を帯の高さに合わせて詰める今回、
              この行にも同じ line-height を適用すれば（中身が空文字でも1行ぶんの高さは残るため）
              通常/スペシャルで常に同じ高さになる＝minHeight を持たせなくても崩れない。
              元は 0.75rem(12px)。文言・色の決まりは MemberSelect と同じ、フォントサイズだけ14px以上に引き上げ。 */}
          <p
            className="hi-special-subtitle"
            style={{
              fontSize: "0.875rem",
              fontWeight: 700,
              letterSpacing: "0.02em",
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
                色を変えるたび key が変わって再マウント→小さく跳ねる演出が走る。
                大きさ・位置は変えない（オーナー指定）。はみ出しは外側の .hi-entry-inner が切る。 */}
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
              className={isLandscape ? "hi-color-intro-landscape" : "hi-color-intro"}
              style={{
                fontSize: "0.95rem",
                fontWeight: 500,
                textAlign: "center",
                color: "#c6ccd2",
                position: "relative",
                zIndex: 1,
              }}
            >
              {isSpecial ? "好きな色だよね？" : "好きな色は？"}
            </p>

            <div
              className="hi-color-rows"
              style={{
                display: "flex",
                flexDirection: "column",
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
                  className="hi-color-circle-event"
                  style={{
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
                  className={isLandscape ? undefined : "hi-color-row"}
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    flexWrap: "nowrap",
                    ...(isLandscape ? { gap: "0.5rem" } : {}),
                  }}
                >
                  {row.members.map((m) => {
                    const isSelected = selectedId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-label={`color ${m.color}`}
                        aria-pressed={isSelected}
                        onClick={() => handlePickColor(m.id)}
                        className={isLandscape ? "hi-color-circle-landscape" : "hi-color-circle"}
                        style={{
                          // 選択時は transform: scale で拡大するだけなので、
                          // 行の高さも他の丸の位置も動かない。
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
                className={isLandscape ? undefined : "hi-color-row"}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  flexWrap: "nowrap",
                  ...(isLandscape ? { gap: "0.5rem" } : {}),
                }}
              >
                {NEW_MEMBERS.map((m) => {
                  const isSelected = selectedId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-label={`color ${m.color}`}
                      aria-pressed={isSelected}
                      onClick={() => handlePickColor(m.id)}
                      className={isLandscape ? "hi-color-circle-landscape" : "hi-color-circle"}
                      style={{
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
            className="hi-invite"
            style={{
              fontSize: "1rem", // 16px以上
              fontWeight: 700,
              textAlign: "center",
              color: "#f5f7fa",
              position: "relative",
              zIndex: 1,
            }}
          >
            {selectedEvent?.enterLabel ?? "みんな、幸せになりたいか～！？"}
          </p>

          {/* 公式動画リンクと、上級編（振り練習）へのアイコンを同じ行に並べる。
              見た目（アイコン単体の控えめなボタン、リンクの下線）は元のまま、位置だけ同じ行へ寄せた。 */}
          <div
            className="hi-links-row"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            {onOpenAdvanced && (
              <button
                type="button"
                aria-label="上級編へ"
                onClick={onOpenAdvanced}
                className="hi-advanced-btn"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  opacity: 0.85,
                  display: "inline-flex",
                }}
              >
                <FaIcon icon={faHandPointer} size={26} color="#9aa0a6" />
              </button>
            )}
            <div
              className="hi-links-text"
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
      </div>

      {/* 版の札。分岐プレビュー・手元だけ右下に出す（本番には出ない）。
          なぞる中身(.hi-entry-inner)の外＝帯の器（HiTensionPage 側の入口コンテナ）を基準にした
          position:absolute。なぞる中身が縦にスクロールしても、この札は帯の右下すみに固定されたまま動かない。 */}
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
    </>
  );
}
