import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { Application, Container, Sprite, Texture, Ticker } from "pixi.js";
import { getHandTexture, seatFromHash } from "../handTexture";
import { findMember } from "../data";
import type { HiSession } from "../api";

export type HandsCanvasApi = {
  spawnSelf: () => void;
  onTimeUpdate: (currentTime: number) => void;
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

function hexToTint(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16);
}

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
    const targetSize = params.isSelf ? SELF_SIZE : BASE_SIZE;
    const texMax = Math.max(texture.width, texture.height) || 1;
    sprite.scale.set(targetSize / texMax);
    sprite.tint = hexToTint(params.color);
    const baseAlpha = params.isToday ? 1.0 : NON_TODAY_ALPHA;
    sprite.alpha = baseAlpha;

    const baselineY = params.yRatio * h;
    sprite.x = params.xRatio * w;
    sprite.y = baselineY;

    layer.addChild(sprite);

    // 仕様5.1〜5.2: ぴょん1回(+20%で二段ジャンプ)、フェードアウト
    const jumpHeight = 60 + Math.random() * 40;       // 60〜100px
    const upDur = 200 + Math.random() * 100;          // 200〜300ms
    const holdDur = 50 + Math.random() * 50;          // 50〜100ms
    const downDur = 200 + Math.random() * 100;        // 200〜300ms
    const fadeDur = 150;
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
    onTimeUpdate(currentTime: number) {
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
