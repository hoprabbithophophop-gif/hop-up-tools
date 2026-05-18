import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
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
  receiveLiveTap: (memberId: string, seatIndex: number, videoTime: number) => void;
};

interface Props {
  sessions: HiSession[];
  selfMemberId: string | null;
  selfSeatHash: number;
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

/**
 * 参加順インデックスから✋の位置を決める（リアルタイムセッション用）。
 * 最大8人（2行×4列）。
 */
function seatIndexToPosition(index: number): { xRatio: number; yRatio: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    xRatio: 0.15 + col * 0.233,
    yRatio: 0.82 - row * 0.18,
  };
}

const LIVE_QUEUE_MAX = 100;
const LIVE_DISCARD_SEC = 3;

type QueuedLiveTap = { videoTime: number; memberId: string; seatIndex: number };

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInQuad(t: number): number {
  return t * t;
}

const HandsCanvas = forwardRef<HandsCanvasApi, Props>(function HandsCanvas(
  { sessions, selfMemberId, selfSeatHash },
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

  // バケット → 該当セッションのインデックス(検索を O(1) にする)
  const bucketIndex = useMemo<Map<number, BucketEntry[]>>(() => {
    const map = new Map<number, BucketEntry[]>();
    for (const session of sessions) {
      // bucket_indices は重複あり(同じ 0.1秒に2回押せばダブる)
      const counts = new Map<number, number>();
      for (const b of session.bucket_indices) {
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

  // 最新の props を ref に反映(imperative メソッドの中で参照する用)
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { selfMemberIdRef.current = selfMemberId; }, [selfMemberId]);
  useEffect(() => { selfSeatHashRef.current = selfSeatHash; }, [selfSeatHash]);

  // 区間遷移時にlastBucketを初期化(別動画再生・再入場時)
  useEffect(() => {
    lastBucketRef.current = -1;
  }, [selfSeatHash]);

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;

    (async () => {
      const container = containerRef.current;
      if (!container) return;

      const texture = getHandTexture();

      app = new Application();
      await app.init({
        resizeTo: container,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
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
    })();

    return () => {
      cancelled = true;
      const a = appRef.current;
      appRef.current = null;
      textureRef.current = null;
      layerRef.current = null;
      try { a?.destroy(true, { children: true }); } catch { /* ignore */ }
    };
  }, []);

  function spawnHand(params: {
    xRatio: number;
    yRatio: number;
    color: string;
    isSelf: boolean;
    isToday: boolean;
    playedDate?: string;
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

    // ぴょん1回(+20%で二段ジャンプ)、フェードアウト
    // up + hold + down を 230〜290ms に収める(0.3s 以内)
    const jumpHeight = 60 + Math.random() * 40;       // 60〜100px
    const upDur = 100 + Math.random() * 20;           // 100〜120ms
    const holdDur = 30 + Math.random() * 20;          // 30〜50ms
    const downDur = 100 + Math.random() * 20;         // 100〜120ms
    const fadeDur = 120;
    const doDouble = Math.random() < 0.2;
    const bounceFactor = 0.5; // 二段目は1段目の50%

    let phase:
      | "up" | "hold" | "down"
      | "up2" | "hold2" | "down2"
      | "fade" | "done" = "up";
    let phaseStart = 0;
    let totalMs = 0;

    const onTick = (ticker: Ticker) => {
      totalMs += ticker.deltaMS;
      const local = totalMs - phaseStart;

      switch (phase) {
        case "up": {
          if (local < upDur) {
            sprite.y = baselineY - jumpHeight * easeOutCubic(local / upDur);
          } else {
            sprite.y = baselineY - jumpHeight;
            phaseStart = totalMs;
            phase = "hold";
          }
          break;
        }
        case "hold": {
          if (local >= holdDur) {
            phaseStart = totalMs;
            phase = "down";
          }
          break;
        }
        case "down": {
          if (local < downDur) {
            sprite.y = baselineY - jumpHeight * (1 - easeInQuad(local / downDur));
          } else {
            sprite.y = baselineY;
            phaseStart = totalMs;
            phase = doDouble ? "up2" : "fade";
          }
          break;
        }
        case "up2": {
          const dur = upDur * bounceFactor;
          if (local < dur) {
            sprite.y = baselineY - jumpHeight * bounceFactor * easeOutCubic(local / dur);
          } else {
            sprite.y = baselineY - jumpHeight * bounceFactor;
            phaseStart = totalMs;
            phase = "hold2";
          }
          break;
        }
        case "hold2": {
          if (local >= holdDur * bounceFactor) {
            phaseStart = totalMs;
            phase = "down2";
          }
          break;
        }
        case "down2": {
          const dur = downDur * bounceFactor;
          if (local < dur) {
            sprite.y = baselineY - jumpHeight * bounceFactor * (1 - easeInQuad(local / dur));
          } else {
            sprite.y = baselineY;
            phaseStart = totalMs;
            phase = "fade";
          }
          break;
        }
        case "fade": {
          if (local < fadeDur) {
            sprite.alpha = baseAlpha * (1 - local / fadeDur);
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

  function spawnForBucket(bucket: number) {
    const entries = bucketIndex.get(bucket);
    if (!entries) return;
    for (const { session, count } of entries) {
      const member = findMember(session.member_id);
      if (!member) continue;
      const { xRatio, yRatio } = seatFromHash(session.session_hash);
      for (let i = 0; i < count; i++) {
        spawnHand({
          xRatio, yRatio,
          color: member.color,
          isSelf: false,
          isToday: session.is_today,
          playedDate: session.played_date,
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
      const { xRatio, yRatio } = seatFromHash(selfSeatHashRef.current);
      spawnHand({
        xRatio, yRatio,
        color: member.color,
        isSelf: true,
        isToday: true,
      });
    },
    receiveLiveTap(memberId: string, seatIndex: number, videoTime: number) {
      const now = currentTimeRef.current;
      const ageSecs = now - videoTime;
      if (ageSecs > LIVE_DISCARD_SEC) return; // 古すぎ → 捨てる
      const member = findMember(memberId);
      if (!member) return;
      const spawn = () => {
        const { xRatio, yRatio } = seatIndexToPosition(seatIndex);
        spawnHand({
          xRatio, yRatio,
          color: member.color,
          isSelf: false,
          isToday: true,
          playedDate: new Date().toISOString().slice(0, 10),
        });
      };
      if (videoTime <= now) {
        spawn();
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
              spawnHand({ xRatio, yRatio, color: member.color, isSelf: false, isToday: true, playedDate: new Date().toISOString().slice(0, 10) });
            }
          } else {
            remaining.push(tap);
          }
        }
        liveQueueRef.current = remaining;
      }

      // バケット先頭で発火させる単純な floor。
      // 100ms poll の平均遅延が +50ms 乗ることで、結果的にバケット中央で
      // 発火する形になる(押下時刻の期待値=中央と一致)。
      // 余計なシフトを足すと平均ズレを増やすだけなので素のままで良い。
      const newBucket = Math.floor(currentTime * 10);
      const lastBucket = lastBucketRef.current;
      if (newBucket === lastBucket) return;
      lastBucketRef.current = newBucket;
      // 初回・大ジャンプ(シーク)時は湧き出しスキップ
      if (lastBucket < 0 || newBucket < lastBucket || newBucket - lastBucket > 30) return;
      for (let b = lastBucket + 1; b <= newBucket; b++) {
        spawnForBucket(b);
      }
    },
  }), [bucketIndex]);

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
