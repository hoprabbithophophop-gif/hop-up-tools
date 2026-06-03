import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
// PixiJS は内部で `new Function(...)` を使うため、CSP の script-src に unsafe-eval が
// 含まれない環境(Cloudflare Pages のデフォルト)では起動できない。
// `pixi.js/unsafe-eval` を side-effect import すると eval を使わない別実装に切り替わる。
// import そのものに副作用があるので、pixi.js の他 import より前に置く。
import "pixi.js/unsafe-eval";
import { Application, Container, Sprite, Texture, Ticker } from "pixi.js";
import { getHandTexture, seatFromHash } from "../handTexture";
import { findMember } from "../data";
import type { HiSession } from "../api";

export type HandsCanvasApi = {
  spawnSelf: () => void;
  onTimeUpdate: (currentTime: number) => void;
  receiveLiveTap: (memberId: string, seatIndex: number, videoTime: number, lagMs: number) => void;
};

interface Props {
  sessions: HiSession[];
  selfMemberId: string | null;
  selfSeatHash: number;
  /** リアルタイム再生中の自分の席番号（0始まり）。横一列の整列位置に使う。ソロ時は -1 */
  selfSeatIndex?: number;
  /** 診断用: Pixi/WebGL 関連イベントを親に通知（後で削除） */
  onPixiEvent?: (event: string, detail?: string) => void;
}

// バケットインデックスに紐づく「(セッション, このバケットでの押下回数)」
type BucketEntry = { session: HiSession; count: number };

const BASE_SIZE = 60;
const SELF_SIZE = 72; // 仕様5.5: 自分は他人の約20%大きく
const NON_TODAY_ALPHA = 0.4;
// 跳躍してもキャンバス上端(プレイヤー直下)で✋が見切れないための上余白。
// スプライト高(最大 SELF_SIZE) + 最大跳躍(jumpHeight 最大100) + バッファ。
const TOP_MARGIN = SELF_SIZE + 120;

function hexToTint(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16);
}

/**
 * 累計セッション数に応じた✋サイズの倍率。
 * 100セッションまでは 100%、そこから 1000セッションへ向けて線形に縮小、
 * 1000以降は 50% で固定。人が増えても画面密度をだいたい一定に保つ。
 */
function crowdScale(sessionCount: number): number {
  const t = Math.min(1, Math.max(0, (sessionCount - 100) / 900));
  return 1 - t * 0.5;
}

/**
 * セッションの日付に応じた✋サイズの倍率（区間線形減衰）。
 * day0=100%, day1=80%, day7=50%, day30=20%, それ以降は20%固定。
 */
function ageScale(playedDate: string): number {
  const days = (Date.now() - new Date(playedDate).getTime()) / 86400000;
  if (days <= 0) return 1.0;
  if (days <= 1) return 1.0 - 0.2 * days;
  if (days <= 7) return 0.8 - (0.3 / 6) * (days - 1);
  if (days <= 30) return 0.5 - (0.3 / 23) * (days - 7);
  return 0.2;
}

// ✋の着地点を収める安全な縦帯（0=領域上端/TOP_MARGIN直下, 1=領域下端）。
// タップボタンは再生エリア上部にあり TOP_MARGIN で上側を保護済み。下端は「中断して戻る」
// ボタンの上で止めて、ボタンが✋履歴より下に来るようにする（下端まで広げると履歴がボタンに
// 被る）。
const BAND_TOP = 0.10;
const BAND_BOT = 0.78;

// 自分（と相手）の大きい✋の着地点。タップボタンは再生エリア上部にあるので、
// ここを下寄り(0.75)にして上昇アニメがボタンに重なって隠れないようにする。
// （履歴✋は小さいので帯の中＝多少ボタン寄りでも問題ない）
const SELF_Y = 0.75;

/**
 * 参加順インデックスから✋の位置を決める（リアルタイムセッション用・上限2人）。
 * 左右に等間隔（1/3・2/3）。yは下寄り（上昇アニメがタップボタンの裏に隠れない）。
 */
function seatIndexToPosition(index: number): { xRatio: number; yRatio: number } {
  const col = index % 2;                 // 上限2人
  return {
    xRatio: (col + 1) / 3,               // 0→0.333, 1→0.667（左右等間隔）
    yRatio: SELF_Y,                       // 下寄り
  };
}

const LIVE_QUEUE_MAX = 100;
const LIVE_DISCARD_SEC = 3;
// 遅延した✋のアニメ先送り量の上限（ms）。上昇(最大120ms)+滞空(最大50ms)分までは飛ばし、
// それ以上ラグが大きくても「上昇アニメ」だけは必ず見せる(挙げた瞬間を残すため)。
const MAX_EXTRAPOLATION_MS = 170;

type QueuedLiveTap = { videoTime: number; memberId: string; seatIndex: number };

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const HandsCanvas = forwardRef<HandsCanvasApi, Props>(function HandsCanvas(
  { sessions, selfMemberId, selfSeatHash, selfSeatIndex, onPixiEvent },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const textureRef = useRef<Texture | null>(null);
  const layerRef = useRef<Container | null>(null);
  const lastBucketRef = useRef<number>(-1);
  const currentTimeRef = useRef<number>(0);
  const liveQueueRef = useRef<QueuedLiveTap[]>([]);
  const sessionsRef = useRef<HiSession[]>(sessions);
  const selfMemberIdRef = useRef<string | null>(selfMemberId);
  const selfSeatHashRef = useRef<number>(selfSeatHash);
  const selfSeatIndexRef = useRef<number | undefined>(selfSeatIndex);
  const onPixiEventRef = useRef<typeof onPixiEvent>(onPixiEvent);
  useEffect(() => { onPixiEventRef.current = onPixiEvent; }, [onPixiEvent]);
  // WebGL コンテキストロスト時の再初期化トリガ（カウンタを増やすと init useEffect が再実行される）
  const [reinitCount, setReinitCount] = useState(0);

  // バケット → 該当セッションのインデックス(検索を O(1) にする)
  const bucketIndex = useMemo<Map<number, BucketEntry[]>>(() => {
    const map = new Map<number, BucketEntry[]>();
    for (const session of sessions) {
      // 0.05秒刻みの細かいバケットを優先(人間の叩くブレが同じマスに丸まって機械っぽく揃うのを防ぐ)。
      // 古いビューで列が無い場合は 0.1秒刻みを2倍して 0.05秒スケールに合わせる。
      const buckets = session.bucket_indices_20 ?? session.bucket_indices.map((b) => b * 2);
      // 重複あり(同じ 0.05秒に2回押せばダブる)
      const counts = new Map<number, number>();
      for (const b of buckets) {
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      for (const [bucket, count] of counts) {
        const arr = map.get(bucket) ?? [];
        arr.push({ session, count });
        map.set(bucket, arr);
      }
    }
    return map;
  }, [sessions]);

  // セッション → ✋の配置(千鳥グリッド)。並び順は毎プレイ(selfSeatHash)で変え、色と位置を
  // 固定で結びつけない（同じ色が毎回端で見切れるのを防ぐ）。同一プレイ中は安定なので再生中に
  // ✋がワープすることはない。安全帯 BAND_TOP〜BAND_BOT に収め、上部のタップボタン裏を避ける。
  const sessionLayout = useMemo<Map<number, { xRatio: number; yRatio: number }>>(() => {
    const n = sessions.length;
    const map = new Map<number, { xRatio: number; yRatio: number }>();
    if (n === 0) return map;
    // selfSeatHash を種に session_hash を撹拌して並べ替える（毎プレイで席替え）。
    const seed = selfSeatHash >>> 0;
    const mix = (h: number) => {
      let x = (h ^ seed) >>> 0;
      x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
      return (x ^ (x >>> 16)) >>> 0;
    };
    const sorted = [...sessions].sort((a, b) => mix(a.session_hash) - mix(b.session_hash));
    // 横長になるよう列を多めに（縦帯が狭いので）。行数を抑えることで、奇数行を半セル
    // ずらす千鳥が「偶数行どうし・奇数行どうしが揃う」状態に陥らず、互い違いが効く。
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 2.2))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const step = cols > 1 ? 1 / (cols - 1) : 0; // 列間隔（端の✋が画面端で半分見切れる 0..1）
    sorted.forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // 偶数行（最前列を含む）を半セルずらして千鳥に並べる。最前列の中央が空くので、
      // 画面中央上部のタップ✋ボタンの真下に履歴✋が来ない（重ならない）。後列の隙間から
      // 前後の✋が覗き、端の✋は画面端で見切れて「画面外にもいる」余地を作る。
      const brick = ((row + 1) % 2) * step / 2;
      const xRatio = cols === 1 ? 0.5 : col * step + brick;
      const yRatio = rows === 1
        ? (BAND_TOP + BAND_BOT) / 2
        : BAND_TOP + ((row + 0.5) / rows) * (BAND_BOT - BAND_TOP); // 帯の中で行も等間隔
      map.set(s.session_hash, { xRatio, yRatio });
    });
    return map;
  }, [sessions, selfSeatHash]);

  // 最新の props を ref に反映(imperative メソッドの中で参照する用)
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { selfMemberIdRef.current = selfMemberId; }, [selfMemberId]);
  useEffect(() => { selfSeatHashRef.current = selfSeatHash; }, [selfSeatHash]);
  useEffect(() => { selfSeatIndexRef.current = selfSeatIndex; }, [selfSeatIndex]);

  // 区間遷移時にlastBucketを初期化(別動画再生・再入場時)
  useEffect(() => {
    lastBucketRef.current = -1;
  }, [selfSeatHash]);

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;
    let onContextLost: ((e: Event) => void) | null = null;
    let onContextRestored: (() => void) | null = null;
    let canvasEl: HTMLCanvasElement | null = null;

    onPixiEventRef.current?.("pixi_init_start", reinitCount > 0 ? `reinit=${reinitCount}` : undefined);

    (async () => {
      const container = containerRef.current;
      if (!container) { onPixiEventRef.current?.("pixi_init_fail", "no container"); return; }

      const texture = getHandTexture();

      app = new Application();
      try {
        await app.init({
          resizeTo: container,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        });
      } catch (e) {
        onPixiEventRef.current?.("pixi_init_fail", e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

      container.appendChild(app.canvas);
      const layer = new Container();
      app.stage.addChild(layer);

      appRef.current = app;
      textureRef.current = texture;
      layerRef.current = layer;
      canvasEl = app.canvas as HTMLCanvasElement;

      // WebGL コンテキストロスト復旧（Android 等の GPU 圧迫時に発生しやすい）
      onContextLost = (e: Event) => {
        e.preventDefault(); // ブラウザにコンテキスト復元の機会を与える
        onPixiEventRef.current?.("webgl_context_lost");
      };
      onContextRestored = () => {
        onPixiEventRef.current?.("webgl_context_restored");
        // useEffect を再実行させて Pixi 全体を作り直す
        setReinitCount(c => c + 1);
      };
      canvasEl.addEventListener("webglcontextlost", onContextLost);
      canvasEl.addEventListener("webglcontextrestored", onContextRestored);

      const rendererType = (app.renderer as unknown as { type?: number }).type === 1 ? "webgl" : "unknown";
      onPixiEventRef.current?.("pixi_init_ok", `r=${rendererType}`);
    })();

    return () => {
      cancelled = true;
      const a = appRef.current;
      if (canvasEl) {
        if (onContextLost) canvasEl.removeEventListener("webglcontextlost", onContextLost);
        if (onContextRestored) canvasEl.removeEventListener("webglcontextrestored", onContextRestored);
      }
      appRef.current = null;
      textureRef.current = null;
      layerRef.current = null;
      try { a?.destroy(true, { children: true }); } catch { /* ignore */ }
    };
  }, [reinitCount]);

  function spawnHand(params: {
    xRatio: number;
    yRatio: number;
    color: string;
    isSelf: boolean;
    isToday: boolean;
    playedDate?: string;
    /** アニメをこの ms 分だけ先に進めてスポーンする（遅延した他人の✋の補正） */
    animationOffsetMs?: number;
  }) {
    const app = appRef.current;
    const texture = textureRef.current;
    const layer = layerRef.current;
    if (!app || !texture || !layer) return;

    const w = app.screen.width;
    const h = app.screen.height;
    if (w === 0 || h === 0) return;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1.0); // 下端中央(着地地点を yRatio に固定)
    // 累計セッション数 × 日付経過に応じて✋を縮小(自分も同率なので「自分は1.2倍」は維持)
    const crowdK = crowdScale(sessionsRef.current.length);
    const ageK = params.playedDate ? ageScale(params.playedDate) : 1.0;
    const targetSize = (params.isSelf ? SELF_SIZE : BASE_SIZE) * crowdK * ageK;
    const texMax = Math.max(texture.width, texture.height) || 1;
    sprite.scale.set(targetSize / texMax);
    sprite.tint = hexToTint(params.color);
    const baseAlpha = params.isToday ? 1.0 : NON_TODAY_ALPHA;
    sprite.alpha = baseAlpha;

    // 上端に TOP_MARGIN 分の余白を確保した残り領域に着地点を配置する。
    // これで yRatio が小さい(=上寄りの)席でも、跳躍が上端で見切れない。
    const usableH = Math.max(1, h - TOP_MARGIN);
    const baselineY = TOP_MARGIN + params.yRatio * usableH;
    sprite.x = params.xRatio * w;
    sprite.y = baselineY;

    layer.addChild(sprite);

    // 溜め(squash) → 上昇 → 軽い滞空 → 下降しながらフェードアウト（二段ジャンプなし）。
    // タップした瞬間に一瞬グッと縮んでから勢いよく上がる「予備動作」で手応えを出し、
    // 最後は元の位置に落ちながら消えるので、連打しても上に積もって居座らない。
    // 値はすべて固定（揺らさない）。狙った1つの気持ちいいモーションを全✋で再現するため。
    const jumpHeight = 80;        // 上昇量(px)
    const squashDur = 50;         // 溜め: scale を SQUASH_SCALE まで縮める時間
    const upDur = 220;            // 上昇: しっかり見せる
    const holdDur = 80;           // 滞空: 頂点で軽く粘る
    const downFadeDur = 180;      // 下降しながらフェードアウト
    const SQUASH_SCALE = 0.85;    // 溜め時の最小スケール倍率
    const baseScale = sprite.scale.x; // spawn 時に設定済みのスケールを基準にする

    let phase: "squash" | "up" | "hold" | "downfade" | "done" = "squash";
    let phaseStart = 0;
    // 遅延した✋はアニメを先に進めた状態から開始（FPS式の予測）
    let totalMs = params.animationOffsetMs ?? 0;

    const onTick = (ticker: Ticker) => {
      totalMs += ticker.deltaMS;
      const local = totalMs - phaseStart;

      switch (phase) {
        case "squash": {
          if (local < squashDur) {
            // baseScale → baseScale*SQUASH_SCALE へ縮む（タップの溜め）
            const k = local / squashDur;
            sprite.scale.set(baseScale * (1 - (1 - SQUASH_SCALE) * k));
          } else {
            sprite.scale.set(baseScale * SQUASH_SCALE);
            phaseStart = totalMs;
            phase = "up";
          }
          break;
        }
        case "up": {
          if (local < upDur) {
            const k = easeOutCubic(local / upDur);
            sprite.y = baselineY - jumpHeight * k;
            // 縮んだスケールを上昇とともに通常へ戻す（伸び＝stretch感）
            sprite.scale.set(baseScale * (SQUASH_SCALE + (1 - SQUASH_SCALE) * k));
          } else {
            sprite.y = baselineY - jumpHeight;
            sprite.scale.set(baseScale);
            phaseStart = totalMs;
            phase = "hold";
          }
          break;
        }
        case "hold": {
          if (local >= holdDur) {
            phaseStart = totalMs;
            phase = "downfade";
          }
          break;
        }
        case "downfade": {
          if (local < downFadeDur) {
            const k = local / downFadeDur;
            // 頂点(baselineY - jumpHeight)から元の baselineY へ落としつつ消す。
            // 落下は easeIn(k*k)で「重力で加速して落ちる」感、フェードは線形。
            sprite.y = baselineY - jumpHeight * (1 - k * k);
            sprite.alpha = baseAlpha * (1 - k);
          } else {
            phase = "done";
          }
          break;
        }
      }

      if (phase === "done") {
        app.ticker.remove(onTick);
        try { sprite.destroy(); } catch { /* ignore */ }
      }
    };

    app.ticker.add(onTick);
  }

  function spawnForBucket(bucket: number, animationOffsetMs: number) {
    const entries = bucketIndex.get(bucket);
    if (!entries) return;
    for (const { session, count } of entries) {
      const member = findMember(session.member_id);
      if (!member) continue;
      const { xRatio, yRatio } = sessionLayout.get(session.session_hash) ?? seatFromHash(session.session_hash);
      for (let i = 0; i < count; i++) {
        spawnHand({
          xRatio, yRatio,
          color: member.color,
          isSelf: false,
          isToday: session.is_today,
          playedDate: session.played_date,
          animationOffsetMs,
        });
      }
    }
  }

  useImperativeHandle(ref, () => ({
    spawnSelf() {
      const memberId = selfMemberIdRef.current;
      if (!memberId) return;
      const member = findMember(memberId);
      if (!member) return;
      // リアルタイム時は席ベースの等間隔、ソロ時は中央・中段（動画/ボタンの裏に出ない）
      const seatIdx = selfSeatIndexRef.current;
      const { xRatio, yRatio } =
        seatIdx != null && seatIdx >= 0
          ? seatIndexToPosition(seatIdx)
          : { xRatio: 0.5, yRatio: SELF_Y };
      spawnHand({
        xRatio, yRatio,
        color: member.color,
        isSelf: true,
        isToday: true,
      });
    },
    receiveLiveTap(memberId: string, seatIndex: number, videoTime: number, lagMs: number) {
      const now = currentTimeRef.current;
      // 実測ラグが大きいときだけ記録(効果検証用)。
      if (lagMs > 300) {
        onPixiEventRef.current?.("tap_recv_diff", `lag=${Math.round(lagMs)}ms`);
      }
      const ageSecs = now - videoTime;
      if (ageSecs > LIVE_DISCARD_SEC) return; // 古すぎ → 捨てる
      const member = findMember(memberId);
      if (!member) return;
      const spawn = (animationOffsetMs: number) => {
        const { xRatio, yRatio } = seatIndexToPosition(seatIndex);
        spawnHand({
          xRatio, yRatio,
          color: member.color,
          isSelf: false,
          isToday: true,
          playedDate: new Date().toISOString().slice(0, 10),
          animationOffsetMs,
        });
      };
      if (videoTime <= now) {
        // 既に過ぎたタップ = 遅れて届いた → 実測した片道ラグ分アニメを先送りして補正。
        // ラグ実測値が無い(0)場合は動画位置差で近似フォールバック。
        const offsetMs = lagMs > 0 ? lagMs : (now - videoTime) * 1000;
        spawn(Math.min(offsetMs, MAX_EXTRAPOLATION_MS));
      } else {
        const queue = liveQueueRef.current;
        queue.push({ videoTime, memberId, seatIndex });
        if (queue.length > LIVE_QUEUE_MAX) queue.splice(0, queue.length - LIVE_QUEUE_MAX);
      }
    },
    onTimeUpdate(currentTime: number) {
      currentTimeRef.current = currentTime;

      // live キューを走査してスポーン
      const queue = liveQueueRef.current;
      if (queue.length > 0) {
        const remaining: QueuedLiveTap[] = [];
        for (const tap of queue) {
          if (tap.videoTime <= currentTime) {
            const member = findMember(tap.memberId);
            if (member) {
              const { xRatio, yRatio } = seatIndexToPosition(tap.seatIndex);
              spawnHand({
                xRatio, yRatio,
                color: member.color,
                isSelf: false,
                isToday: true,
                playedDate: new Date().toISOString().slice(0, 10),
                animationOffsetMs: Math.min((currentTime - tap.videoTime) * 1000, MAX_EXTRAPOLATION_MS),
              });
            }
          } else {
            remaining.push(tap);
          }
        }
        liveQueueRef.current = remaining;
      }

      // 0.05秒刻みのバケット先頭で発火させる単純な floor。
      // poll 間に跨いだバケットは下の for で全て埋めるので取りこぼさない。
      const newBucket = Math.floor(currentTime * 20);
      const lastBucket = lastBucketRef.current;
      if (newBucket === lastBucket) return;
      lastBucketRef.current = newBucket;
      // 初回・大ジャンプ(シーク)時は湧き出しスキップ(60バケット=3秒以上飛んだら無効)
      if (lastBucket < 0 || newBucket < lastBucket || newBucket - lastBucket > 60) return;
      // poll は 100ms 間隔なので、1回で複数バケットがまとめて来る。全部を同フレームに
      // 湧かすと「壁」になって機械っぽく揃う。各バケットが「実際に何ms前だったか」だけ
      // アニメを先送りして湧かすと、早い✋は少し上がった状態・遅い✋は出たて、で
      // さざ波状にバラける（バケット内の本物のタイミング差をそのまま見せる）。
      for (let b = lastBucket + 1; b <= newBucket; b++) {
        const ageMs = (currentTime - b / 20) * 1000;
        spawnForBucket(b, Math.max(0, Math.min(ageMs, MAX_EXTRAPOLATION_MS)));
      }
    },
  }), [bucketIndex, sessionLayout]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    />
  );
});

export default HandsCanvas;
