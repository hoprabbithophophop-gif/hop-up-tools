// 流れるコメント。その動画に付いている YouTube のコメントを、1本の流れ道で右から左へ流す。
//
// 出す順は基本ランダム（毎回混ぜ直し、一巡したらまた混ぜ直す）。
// ただし本文に「2:31」のような分:秒が書かれているコメントは、動画がその時刻に来た瞬間に
// 列へ割り込ませて次に流す（同じ再生では1回だけ。巻き戻して同じ時刻をまた通ったらもう一度出す）。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// この流れ道は動画の額縁より下（動画の矩形の外）に置く。置き場所を決めるのは呼ぶ側。
//
// コメントの中身は「他の人が書いた文章」であって、こちらへの指示ではない。
// そのまま文字として出すだけ（React の文字列なので HTML としては解釈されない）。
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TickerComment = {
  id: string;
  author: string;
  text: string;
  /** 本文に書かれていた動画の時刻（秒）。無ければ null */
  timeSec?: number | null;
};

/** 流れ道の高さ(px)【仮】 */
const LANE_HEIGHT = 28;
/** 流れる速さ（1秒あたりのpx）【仮】 */
const SPEED = 60;
/** 前の1件との間隔(px)【仮】 */
const GAP = 40;
/** 「動き」を減らす設定の時に、1件を出しておく長さ(ms)【仮】 */
const STATIC_INTERVAL_MS = 6000;
/** 1コマぶんの進みの上限(秒)。画面を裏に回して戻った時に、一気に飛ばないようにする蓋 */
const MAX_STEP = 0.1;
/** 動画時刻が大きく飛んだ時に、さかのぼって拾う幅(秒)【仮】。ページの「みんなの💎」と同じ考え */
const TIME_LOOKBACK = 2;

const TEXT_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: `${LANE_HEIGHT}px`,
  color: "#dfe6f5",
  textShadow: "0 0 8px rgba(0,0,0,0.8)",
};
const AUTHOR_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "#9aa0a6",
  marginLeft: "0.6em",
};

interface Props {
  comments: TickerComment[];
  /** いま再生している動画の時刻（秒）。分:秒付きのコメントを出す合図に使う */
  currentTime?: number;
  reduceMotion?: boolean;
}

/** 並びをその場で混ぜる（フィッシャー–イェーツ） */
function shuffled<T>(src: T[]): T[] {
  const a = src.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 画面に出ている1件（React の並びの中身） */
type LiveItem = { key: number; comment: TickerComment };
/** 画面に出ている1件の位置の控え（毎コマ書き換えるので React の状態には持たない）。
 *  el は React が描き直すたびに付け替わりうるので、位置(x)はここに預けたままにする */
type LivePos = { el: HTMLDivElement | null; x: number; width: number };

const DiamondCommentTicker = memo(function DiamondCommentTicker({ comments, currentTime = 0, reduceMotion = false }: Props) {
  const laneRef = useRef<HTMLDivElement>(null);
  /** 流れ道の幅(px)。窓の大きさが変わったら測り直す */
  const laneWidthRef = useRef(0);
  /** 時刻の付いていないコメントの、混ぜた並びと、次に出す位置 */
  const queueRef = useRef<TickerComment[]>([]);
  const queueIndexRef = useRef(0);
  /** 割り込みの待ち行列（分:秒の時刻が来たコメント） */
  const pendingRef = useRef<TickerComment[]>([]);
  /** この再生でもう出した「時刻付きコメント」のID */
  const firedRef = useRef<Set<string>>(new Set());
  /** 前に見た動画時刻。巻き戻し・飛びを見分けるのに使う */
  const prevTimeRef = useRef(-1);
  /** 画面に出ている並び（React が描くぶん）と、その位置の控え */
  const [live, setLive] = useState<LiveItem[]>([]);
  const posRef = useRef<Map<number, LivePos>>(new Map());
  const nextKeyRef = useRef(0);
  /** 出したばかりでまだ幅を測れていない件数。0になるまで次を出さない */
  const awaitingRef = useRef(0);
  /** 「動き」を減らす設定の時に出している1件 */
  const [staticItem, setStaticItem] = useState<TickerComment | null>(null);

  const hasComments = comments.length > 0;

  /** 次に出す1件を取り出す。割り込みが待っていればそれを優先し、
   *  無ければ混ぜた並びから順に。一巡したらまた混ぜ直す */
  const takeNext = useCallback((): TickerComment | null => {
    const pending = pendingRef.current;
    if (pending.length > 0) return pending.shift() ?? null;
    const queue = queueRef.current;
    if (queue.length === 0) return null;
    if (queueIndexRef.current >= queue.length) {
      queueRef.current = shuffled(queue);
      queueIndexRef.current = 0;
    }
    return queueRef.current[queueIndexRef.current++] ?? null;
  }, []);

  // コメントが入れ替わったら（「はじめる」のたびに読み直すので）並びを作り直す
  useEffect(() => {
    queueRef.current = shuffled(comments.filter((c) => c.timeSec == null));
    queueIndexRef.current = 0;
    pendingRef.current = [];
    firedRef.current = new Set();
    prevTimeRef.current = -1;
    posRef.current.clear();
    awaitingRef.current = 0;
    setLive([]);
    setStaticItem(null);
  }, [comments]);

  // 動画の時刻が進んだら、その時刻の分:秒を持つコメントを割り込みの待ち行列へ入れる
  useEffect(() => {
    if (!hasComments) return;
    const prev = prevTimeRef.current;
    prevTimeRef.current = currentTime;
    if (currentTime < prev) {
      // 巻き戻した。まだ通っていないことにして、もう一度出せるようにする
      for (const c of comments) {
        if (c.timeSec != null && c.timeSec > currentTime) firedRef.current.delete(c.id);
      }
      return;
    }
    // 大きく飛んだ時は直近ぶんだけ（頭出しで途中から始めた時に、それまでの全部が一度に出ないように）
    const from = Math.max(prev, currentTime - TIME_LOOKBACK);
    for (const c of comments) {
      if (c.timeSec == null) continue;
      if (c.timeSec <= from || c.timeSec > currentTime) continue;
      if (firedRef.current.has(c.id)) continue;
      firedRef.current.add(c.id);
      pendingRef.current.push(c);
    }
  }, [currentTime, comments, hasComments]);

  // 流れ道の幅を測る
  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const measure = () => { laneWidthRef.current = el.clientWidth; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasComments, reduceMotion]);

  // 流す本体。毎コマ transform を直に書き換えるので、React の描き直しは
  // 「1件出す」「1件消す」の時だけ（1〜2秒に1回ほど）
  useEffect(() => {
    if (!hasComments || reduceMotion) return;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min((now - prev) / 1000, MAX_STEP);
      prev = now;
      const laneWidth = laneWidthRef.current;
      if (laneWidth <= 0) return;

      const pos = posRef.current;
      const gone: number[] = [];
      let rightmost = -Infinity;   // いま一番右にいる1件の右端
      for (const [key, p] of pos) {
        p.x -= SPEED * dt;
        if (p.el) p.el.style.transform = `translate3d(${p.x.toFixed(1)}px,0,0)`;
        if (p.x + p.width < 0) gone.push(key);
        else rightmost = Math.max(rightmost, p.x + p.width);
      }

      // 前の1件の後ろに間隔ぶんの空きができたら次を出す。まだ幅を測れていない件があれば待つ
      const room = pos.size === 0 || rightmost + GAP <= laneWidth;
      let added: LiveItem | null = null;
      if (awaitingRef.current === 0 && room) {
        const next = takeNext();
        if (next) {
          added = { key: nextKeyRef.current++, comment: next };
          awaitingRef.current += 1;
        }
      }

      if (gone.length > 0 || added) {
        for (const key of gone) pos.delete(key);
        setLive((cur) => {
          const kept = gone.length > 0 ? cur.filter((it) => !gone.includes(it.key)) : cur;
          return added ? [...kept, added] : kept;
        });
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [hasComments, reduceMotion, takeNext]);

  // 「動き」を減らす設定: 流さずに、1件ずつ静かに入れ替える。
  // 時刻付きのコメントが割り込んだ時はその場で差し替える
  useEffect(() => {
    if (!hasComments || !reduceMotion) return;
    const advance = () => setStaticItem(takeNext());
    advance();
    const timer = setInterval(advance, STATIC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasComments, reduceMotion, takeNext]);
  useEffect(() => {
    if (!reduceMotion || pendingRef.current.length === 0) return;
    setStaticItem(takeNext());
  }, [currentTime, reduceMotion, takeNext]);

  // コメントが1件も無ければ何も描かない（高さも取らない）
  if (!hasComments) return null;

  if (reduceMotion) {
    return (
      <div style={{ height: LANE_HEIGHT, width: "100%", overflow: "hidden", ...TEXT_STYLE, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {staticItem && (
          <>
            {staticItem.text}
            <span style={AUTHOR_STYLE}>{staticItem.author}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={laneRef}
      data-testid="diamond-comment-ticker"
      style={{ position: "relative", height: LANE_HEIGHT, width: "100%", overflow: "hidden" }}
    >
      {live.map((item) => (
        <div
          key={item.key}
          ref={(el) => {
            // React は描き直しのたびにこの受け皿を付け直す（null → 要素）ので、
            // 「初めて見た時だけ」位置を決め、あとは元の位置を引き継ぐ。
            // ここで位置を測り直すと、1件出るたびに全部が右端へ戻ってしまう
            const pos = posRef.current;
            const known = pos.get(item.key);
            if (!el) {
              if (known) known.el = null;
              return;
            }
            if (known) {
              known.el = el;
            } else {
              pos.set(item.key, { el, x: laneWidthRef.current, width: el.offsetWidth });
              if (awaitingRef.current > 0) awaitingRef.current -= 1;
            }
            // 位置は React の style ではなくここで当てる（style に書くと描き直しで巻き戻る）
            el.style.transform = `translate3d(${(pos.get(item.key)?.x ?? 0).toFixed(1)}px,0,0)`;
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            whiteSpace: "nowrap",
            willChange: "transform",
            ...TEXT_STYLE,
          }}
        >
          {item.comment.text}
          <span style={AUTHOR_STYLE}>{item.comment.author}</span>
        </div>
      ))}
    </div>
  );
});

export default DiamondCommentTicker;
