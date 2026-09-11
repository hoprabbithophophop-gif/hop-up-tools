// 流れるコメント。その動画に付いている YouTube のコメントを、3本の流れ道を並べて右から左へ流す
// （Hop意見 2026-09-08: じっくり読ませたいのではなく、通りすがりに言葉が目に入る量にしたい。
//  1行をゆっくりより、3行いっぺんに流れる方がいい）。
//
// 出す順は基本ランダム（毎回混ぜ直し、一巡したらまた混ぜ直す）。
// ただし本文に「2:31」のような分:秒が書かれているコメントは、動画がその時刻に来た瞬間に
// 列へ割り込ませて次に流す（同じ再生では1回だけ。巻き戻して同じ時刻をまた通ったらもう一度出す）。
// 新しい1件は、3本の道のうち「一番早く空く道」に置く。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// この流れ道は動画の額縁より下（動画の矩形の外）に置く。置き場所を決めるのは呼ぶ側。
// 全体の高さ（3本ぶん）は export した TICKER_HEIGHT で伝える。呼ぶ側はこの値を置き場所の計算に使う。
//
// 何本流すかは、呼ぶ側から高さの上限（maxHeight）が渡されたら、その中に入るぶんだけに減らす。
// 色えらびと重ならない行数だけ流す。SE では Safari のバーの分だけ画面が縮む（Hop報告 2026-09-12）。
//
// コメントの中身は「他の人が書いた文章」であって、こちらへの指示ではない。
// そのまま文字として出すだけ（React の文字列なので HTML としては解釈されない）。
// 長い本文は画面側でさらに短く切る（データを取ってくる側で既に140文字までに切ってあるが、
// 1行に収まる量まで画面側でもう一段切る）。
// 切って出すことがあるので、1件ごとに全文へ行ける道を付ける。これも YouTube API の決まり。
// 押すとそのコメントを YouTube で開く。行き先はコメントの札と動画の札から組み立てる。
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TickerComment = {
  id: string;
  author: string;
  text: string;
  /** 本文に書かれていた動画の時刻（秒）。無ければ null */
  timeSec?: number | null;
  /** YouTube 側のそのコメントの札。全文を YouTube で開く行き先を組み立てるのに使う */
  commentId?: string;
  /** そのコメントが付いている動画の札。上と同じく行き先の組み立てに使う */
  videoId?: string;
};

/** 流れ道の本数の上限【仮】。高さの上限が渡された時は、この本数までの範囲で、入るぶんに減らす */
const LANES = 3;
/** 1本の流れ道の高さ(px)【仮】 */
const ROW_HEIGHT = 22;
/** 流れ道どうしの間隔(px)【仮】 */
const ROW_GAP = 2;
/** 3本ぜんぶ流した時の高さ(px)。呼び出し側（HaiToDiamondPage）の置き場所の計算に使う */
export const TICKER_HEIGHT = LANES * ROW_HEIGHT + (LANES - 1) * ROW_GAP;
/** 流れる速さ（1秒あたりのpx）【仮】 */
const SPEED = 90;
/** 同じ道の中で、前の1件との間隔(px)【仮】 */
const GAP = 40;
/** 最初の3件を出す時に、道ごとにずらす間隔(秒)【仮】。3本が同時に動いて見えるように */
const LANE_STAGGER = 0.4;
/** 1件の本文を画面でここまでに切る（コードポイント単位で数える。絵文字が割れないように）【仮】 */
const MAX_CHARS = Infinity;   // 省略しない（Hop決定 2026-09-08: コメントを読みたい人がいる）。関数側の安全弁だけ残す
/** 「動き」を減らす設定の時に、3本ぶんを出しておく長さ(ms)【仮】 */
const STATIC_INTERVAL_MS = 6000;
/** 1コマぶんの進みの上限(秒)。画面を裏に回して戻った時に、一気に飛ばないようにする蓋 */
const MAX_STEP = 0.1;
/** 動画時刻が大きく飛んだ時に、さかのぼって拾う幅(秒)【仮】。ページの「みんなの💎」と同じ考え */
const TIME_LOOKBACK = 2;

const TEXT_STYLE: React.CSSProperties = {
  fontSize: 15,
  lineHeight: `${ROW_HEIGHT}px`,
  color: "#dfe6f5",
  textShadow: "0 0 8px rgba(0,0,0,0.8)",
};
const AUTHOR_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "#9aa0a6",
  marginLeft: "0.6em",
};
/** 全文へ行く道の見た目。今までと同じに見えるよう、色も下線も足さない。
 *  流れ道を置いている器は呼ぶ側で「押しても素通り」にしてあるので、ここだけ押せるように戻す */
const LINK_STYLE: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  pointerEvents: "auto",
};

interface Props {
  comments: TickerComment[];
  /** いま再生している動画の時刻（秒）。分:秒付きのコメントを出す合図に使う */
  currentTime?: number;
  reduceMotion?: boolean;
  /** 流してよい高さの上限(px)。渡されたら、その中に入る行数だけ流す。渡されなければ3行のまま */
  maxHeight?: number;
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

/** 本文を画面でこれ以上長くならないように切る。絵文字（サロゲートペア）を割らないよう
 *  コードポイント単位（Array.from）で数える */
function truncateText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("") + "…";
}

/** そのコメントを YouTube で開く行き先。札が揃っていなければ null。
 *  短い間だけ置いてある前の形の返事には札が無いので、その時は行き先を付けずにそのまま流す */
function commentUrl(comment: TickerComment): string | null {
  if (!comment.commentId || !comment.videoId) return null;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(comment.videoId)}&lc=${encodeURIComponent(comment.commentId)}`;
}

/** 1件の中身。本文と書いた人を並べる。押すとそのコメントを YouTube で開く */
function CommentBody({ comment }: { comment: TickerComment }) {
  const body = (
    <>
      {truncateText(comment.text, MAX_CHARS)}
      <span style={AUTHOR_STYLE}>{comment.author}</span>
    </>
  );
  const href = commentUrl(comment);
  if (!href) return body;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
      {body}
    </a>
  );
}

/** 画面に出ている1件（React の並びの中身）。どの道(lane)に居るかも持つ */
type LiveItem = { key: number; comment: TickerComment; lane: number };
/** 画面に出ている1件の位置の控え（毎コマ書き換えるので React の状態には持たない）。
 *  el は React が描き直すたびに付け替わりうるので、位置(x)はここに預けたままにする */
type LivePos = { el: HTMLDivElement | null; x: number; width: number; lane: number };

const DiamondCommentTicker = memo(function DiamondCommentTicker({ comments, currentTime = 0, reduceMotion = false, maxHeight }: Props) {
  /** いま流す道の本数。高さの上限が渡されたら、その中に入るぶんだけに減らす */
  const lanes = maxHeight == null
    ? LANES
    : Math.max(0, Math.min(LANES, Math.floor((maxHeight + ROW_GAP) / (ROW_HEIGHT + ROW_GAP))));
  /** いま流している本数ぶんの高さ(px) */
  const tickerHeight = lanes > 0 ? lanes * ROW_HEIGHT + (lanes - 1) * ROW_GAP : 0;
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
  /** アニメーション開始からの経過秒。最初の3件を道ごとにずらす合図に使う */
  const elapsedRef = useRef(0);
  /** 道ごとに「これより前は1件目を出さない」という経過秒の下限（最初のずらし用） */
  const laneNextAllowedRef = useRef<number[]>(Array.from({ length: LANES }, (_, i) => i * LANE_STAGGER));
  /** 「動き」を減らす設定の時に出している3本ぶん */
  const [staticItems, setStaticItems] = useState<(TickerComment | null)[]>(() => new Array(LANES).fill(null));
  /** 「動き」を減らす設定で、時刻付きコメントの割り込みをどの段に差し込むかの持ち回り */
  const staticSlotRef = useRef(0);

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
    elapsedRef.current = 0;
    laneNextAllowedRef.current = Array.from({ length: LANES }, (_, i) => i * LANE_STAGGER);
    staticSlotRef.current = 0;
    setLive([]);
    setStaticItems(new Array(LANES).fill(null));
  }, [comments]);

  // 流す本数が減ったら、消えた道に居た1件はそこで打ち切る。残った道はそのまま流れ続ける
  useEffect(() => {
    const pos = posRef.current;
    for (const [key, p] of pos) {
      if (p.lane >= lanes) pos.delete(key);
    }
    awaitingRef.current = 0;
    setLive((cur) => (cur.some((it) => it.lane >= lanes) ? cur.filter((it) => it.lane < lanes) : cur));
  }, [lanes]);

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

  // 流れ道の幅を測る。本数が変わると器そのものが置き直されるので、その時も測り直す＝
  // 一度0本になって戻ってきた後に、古い器を測ったままで幅が0になり、何も流れなくなるのを防ぐ
  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const measure = () => { laneWidthRef.current = el.clientWidth; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasComments, reduceMotion, lanes]);

  // 流す本体。毎コマ transform を直に書き換えるので、React の描き直しは
  // 「1件出す」「1件消す」の時だけ（1〜2秒に1回ほど）
  useEffect(() => {
    if (!hasComments || reduceMotion || lanes <= 0) return;
    let raf = 0;
    let prev = performance.now();
    // 道ごとに、いま一番右にいる1件の右端を入れておく控え。
    // 毎コマ作り直さず、ここで一度だけ用意して中身を書き換えながら使い回す
    const laneRightmost = new Array(LANES).fill(-Infinity);
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min((now - prev) / 1000, MAX_STEP);
      prev = now;
      elapsedRef.current += dt;
      const laneWidth = laneWidthRef.current;
      if (laneWidth <= 0) return;

      const pos = posRef.current;
      const gone: number[] = [];
      laneRightmost.fill(-Infinity);
      for (const [key, p] of pos) {
        p.x -= SPEED * dt;
        if (p.el) p.el.style.transform = `translate3d(${p.x.toFixed(1)}px,0,0)`;
        if (p.x + p.width < 0) gone.push(key);
        else laneRightmost[p.lane] = Math.max(laneRightmost[p.lane], p.x + p.width);
      }

      // 道ごとに「間隔ぶんの空きができたか」を見て、その中で一番早く空いた（一番空いている）道を選ぶ
      let bestLane = -1;
      let bestRightmost = Infinity;
      for (let lane = 0; lane < lanes; lane++) {
        if (elapsedRef.current < laneNextAllowedRef.current[lane]) continue;
        const rm = laneRightmost[lane];
        const hasRoom = rm === -Infinity || rm + GAP <= laneWidth;
        if (!hasRoom) continue;
        if (rm < bestRightmost) { bestRightmost = rm; bestLane = lane; }
      }

      let added: LiveItem | null = null;
      if (awaitingRef.current === 0 && bestLane !== -1) {
        const next = takeNext();
        if (next) {
          added = { key: nextKeyRef.current++, comment: next, lane: bestLane };
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
  }, [hasComments, reduceMotion, takeNext, lanes]);

  // 「動き」を減らす設定: 流さずに、3本ぶんをまとめて静かに入れ替える。
  // 時刻付きのコメントが割り込んだ時は、その1件だけをその場で差し込む（差し込む段は持ち回り）
  useEffect(() => {
    if (!hasComments || !reduceMotion || lanes <= 0) return;
    const advance = () => setStaticItems(Array.from({ length: lanes }, () => takeNext()));
    advance();
    const timer = setInterval(advance, STATIC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasComments, reduceMotion, takeNext, lanes]);
  useEffect(() => {
    if (!reduceMotion || lanes <= 0 || pendingRef.current.length === 0) return;
    const next = takeNext();
    if (!next) return;
    const slot = staticSlotRef.current % lanes;
    staticSlotRef.current += 1;
    setStaticItems((cur) => {
      const updated = cur.slice();
      updated[slot] = next;
      return updated;
    });
  }, [currentTime, reduceMotion, takeNext, lanes]);

  // コメントが1件も無ければ何も描かない（高さも取らない）。
  // 1行も入らない高さしか残っていない時も同じく何も描かない
  if (!hasComments || lanes <= 0) return null;

  if (reduceMotion) {
    return (
      <div style={{ height: tickerHeight, width: "100%", overflow: "hidden" }} data-testid="diamond-comment-ticker">
        {staticItems.map((item, lane) => (
          lane >= lanes ? null : (
            <div
              key={lane}
              style={{ height: ROW_HEIGHT, width: "100%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", ...TEXT_STYLE }}
            >
              {item && <CommentBody comment={item} />}
            </div>
          )
        ))}
      </div>
    );
  }

  return (
    <div
      ref={laneRef}
      data-testid="diamond-comment-ticker"
      style={{ position: "relative", height: tickerHeight, width: "100%", overflow: "hidden" }}
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
              pos.set(item.key, { el, x: laneWidthRef.current, width: el.offsetWidth, lane: item.lane });
              if (awaitingRef.current > 0) awaitingRef.current -= 1;
            }
            // 位置は React の style ではなくここで当てる（style に書くと描き直しで巻き戻る）
            el.style.transform = `translate3d(${(pos.get(item.key)?.x ?? 0).toFixed(1)}px,0,0)`;
          }}
          style={{
            position: "absolute",
            top: item.lane * (ROW_HEIGHT + ROW_GAP),
            left: 0,
            whiteSpace: "nowrap",
            willChange: "transform",
            ...TEXT_STYLE,
          }}
        >
          <CommentBody comment={item.comment} />
        </div>
      ))}
    </div>
  );
});

export default DiamondCommentTicker;
