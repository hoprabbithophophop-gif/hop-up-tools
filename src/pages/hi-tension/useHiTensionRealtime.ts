import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const CHANNEL_BASE = "hi-tension";

// 「みんなで」待機室の参加上限。seat_index 0〜3 が正規参加者。
export const MAX_PARTICIPANTS = 4;

// 「せーの」後、各端末が✋を押せる猶予（ミリ秒）
export const SENO_WINDOW_MS = 3000;

// tap broadcast の最小送信間隔（≒13回/秒上限）。長押し(150ms間隔)・人力連打では
// 発動しない高めの値。ボタン暴走バグ等の異常送信を頭打ちにするための安全キャップ。
const TAP_BROADCAST_MIN_INTERVAL_MS = 75;

// クロック同期 ping の送信間隔
const CLOCK_PING_INTERVAL_MS = 2000;

// 部屋コードに使う文字（紛らわしい 0/O・1/I/L を除外）
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

/** ランダムな部屋コードを生成する */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** 入力文字列を部屋コードとして正規化する（大文字化＋使用可能文字のみ、最大長で切り詰め） */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

export type Participant = {
  sessionId: string;
  memberId: string;
  joinedAt: number;
};

export type LiveTap = {
  memberId: string;
  seatIndex: number;
  videoTime: number;
};

export type LiveBounce = {
  sessionId: string;
};

/**
 * Supabase Realtime チャンネル（Presence + Broadcast）をまとめて管理する。
 * - 部屋: roomCode が null ならグローバル部屋、文字列なら専用部屋。
 * - 待機登録は宣言的（inWaitingRoom）。
 * - クロック同期: 非ホストが定期的にホストへ ping し、時計のズレを推定する。
 * - 開始フロー: せーの → 各自 ready → ホストが songstart(t0,p0) を配る。
 */
export function useHiTensionRealtime({
  sessionId,
  memberId,
  roomCode,
  inWaitingRoom,
  onSeno,
  onReady,
  onSongStart,
  onSenoFail,
  onTap,
  onBounce,
}: {
  sessionId: string;
  memberId: string | null;
  roomCode: string | null;
  inWaitingRoom: boolean;
  onSeno: (senoAt: number, group: string[]) => void;
  onReady: (sessionId: string) => void;
  onSongStart: (t0: number, p0: number) => void;
  onSenoFail: () => void;
  onTap: (tap: LiveTap) => void;
  onBounce?: (bounce: LiveBounce) => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connected, setConnected] = useState(false);
  const [channelError, setChannelError] = useState(false);

  // Presence キーはタブごとに一意（複数タブで sessionId が被っても上書きされないよう）
  const presenceKeyRef = useRef(`${sessionId}-${Math.random().toString(36).slice(2, 8)}`);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);

  const onSenoRef = useRef(onSeno);
  const onReadyRef = useRef(onReady);
  const onSongStartRef = useRef(onSongStart);
  const onSenoFailRef = useRef(onSenoFail);
  const onTapRef = useRef(onTap);
  const onBounceRef = useRef(onBounce);
  useEffect(() => { onSenoRef.current = onSeno; }, [onSeno]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onSongStartRef.current = onSongStart; }, [onSongStart]);
  useEffect(() => { onSenoFailRef.current = onSenoFail; }, [onSenoFail]);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);
  useEffect(() => { onBounceRef.current = onBounce; }, [onBounce]);

  // 待機登録の意図（チャンネル再接続時に subscribe コールバックから参照する）
  const inWaitingRoomRef = useRef(inWaitingRoom);
  const memberIdRef = useRef(memberId);
  useEffect(() => { inWaitingRoomRef.current = inWaitingRoom; }, [inWaitingRoom]);
  useEffect(() => { memberIdRef.current = memberId; }, [memberId]);

  // 自分の seat_index とホスト判定（presenceKey で比較）
  const mySeatIndex = participants.findIndex(p => p.sessionId === presenceKeyRef.current);
  const isHost = mySeatIndex === 0 && participants.length > 0;
  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // tap broadcast の安全キャップ用
  const lastTapBroadcastAtRef = useRef<number>(0);
  // untrack 後も席番を使えるよう最後の有効値を保持
  const frozenSeatIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (mySeatIndex >= 0) frozenSeatIndexRef.current = mySeatIndex;
  }, [mySeatIndex]);

  // クロック同期: ホスト時計 ≈ 自分の時計 + clockOffset
  const clockOffsetRef = useRef<number>(0);
  const bestRoundtripRef = useRef<number>(Infinity);

  const channelName = roomCode ? `${CHANNEL_BASE}:${roomCode}` : CHANNEL_BASE;

  useEffect(() => {
    const presenceKey = presenceKeyRef.current;
    const supabase = getSupabase();
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: presenceKey },
      },
    });
    channelRef.current = channel;
    subscribedRef.current = false;
    // 部屋が変わったらクロック同期をリセット
    clockOffsetRef.current = 0;
    bestRoundtripRef.current = Infinity;

    const syncParticipants = () => {
      const state = channel.presenceState<{
        session_id: string;
        member_id: string;
        joined_at: number;
      }>();
      const list: Participant[] = [];
      for (const presences of Object.values(state)) {
        for (const p of presences) {
          list.push({ sessionId: p.session_id, memberId: p.member_id, joinedAt: p.joined_at });
        }
      }
      list.sort((a, b) => a.joinedAt - b.joinedAt || a.sessionId.localeCompare(b.sessionId));
      setParticipants(list);
    };

    channel
      .on("presence", { event: "sync" }, syncParticipants)
      // クロック同期 ping/pong
      .on("broadcast", { event: "clock-ping" }, ({ payload }) => {
        // ホストだけが応答する
        if (!isHostRef.current) return;
        if (typeof payload?.from === "string" && typeof payload?.t0 === "number") {
          channel.send({
            type: "broadcast",
            event: "clock-pong",
            payload: { to: payload.from, t0: payload.t0, t1: Date.now() },
          });
        }
      })
      .on("broadcast", { event: "clock-pong" }, ({ payload }) => {
        if (payload?.to !== presenceKey) return;
        if (typeof payload?.t0 !== "number" || typeof payload?.t1 !== "number") return;
        const t2 = Date.now();
        const roundtrip = t2 - payload.t0;
        // 一番ブレてない（往復が最速の）サンプルだけ採用
        if (roundtrip < bestRoundtripRef.current) {
          bestRoundtripRef.current = roundtrip;
          clockOffsetRef.current = ((payload.t1 - payload.t0) + (payload.t1 - t2)) / 2;
        }
      })
      // せーの（ホストが合図）
      .on("broadcast", { event: "seno" }, ({ payload }) => {
        if (typeof payload?.seno_at === "number" && Array.isArray(payload?.group)) {
          onSenoRef.current(payload.seno_at, payload.group as string[]);
        }
      })
      // 各自の ready
      .on("broadcast", { event: "ready" }, ({ payload }) => {
        if (typeof payload?.session_id === "string") onReadyRef.current(payload.session_id);
      })
      // 曲開始（ホストが基準点 t0/p0 を配る）
      .on("broadcast", { event: "songstart" }, ({ payload }) => {
        if (typeof payload?.t0 === "number" && typeof payload?.p0 === "number") {
          onSongStartRef.current(payload.t0, payload.p0);
        }
      })
      // せーの失敗
      .on("broadcast", { event: "seno-fail" }, () => {
        onSenoFailRef.current();
      })
      // ドット跳ね合図
      .on("broadcast", { event: "bounce" }, ({ payload }) => {
        if (typeof payload?.session_id === "string") {
          onBounceRef.current?.({ sessionId: payload.session_id });
        }
      })
      // 再生中のタップ
      .on("broadcast", { event: "tap" }, ({ payload }) => {
        if (payload?.session_id === presenceKey) return;
        if (
          typeof payload?.member_id === "string" &&
          Number.isInteger(payload?.seat_index) &&
          payload.seat_index >= 0 &&
          payload.seat_index <= 7 &&
          typeof payload?.video_time === "number"
        ) {
          onTapRef.current({
            memberId: payload.member_id,
            seatIndex: payload.seat_index,
            videoTime: payload.video_time,
          });
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribedRef.current = true;
          setConnected(true);
          setChannelError(false);
          if (inWaitingRoomRef.current && memberIdRef.current) {
            channel.track({
              session_id: presenceKey,
              member_id: memberIdRef.current,
              joined_at: Date.now(),
            });
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          subscribedRef.current = false;
          setChannelError(true);
          setConnected(false);
        }
      });

    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
      setConnected(false);
      setParticipants([]);
    };
  }, [channelName]);

  // 待機登録/解除（宣言的）
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !subscribedRef.current) return;
    if (inWaitingRoom && memberId) {
      ch.track({
        session_id: presenceKeyRef.current,
        member_id: memberId,
        joined_at: Date.now(),
      });
    } else {
      ch.untrack();
    }
  }, [inWaitingRoom, memberId]);

  // クロック同期 ping: 接続中、非ホストは定期的にホストへ ping
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      if (isHostRef.current) return;
      channelRef.current?.send({
        type: "broadcast",
        event: "clock-ping",
        payload: { from: presenceKeyRef.current, t0: Date.now() },
      });
    }, CLOCK_PING_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connected]);

  /** ホスト時計とのズレ（ms）。ホスト時計 ≈ 自分の時計 + これ */
  const getClockOffset = useCallback(() => clockOffsetRef.current, []);

  /** ホストが「せーの」を送る。group は今回の ready-check 対象（後から来た人を混ぜない） */
  const sendSeno = useCallback((group: string[]) => {
    const senoAt = Date.now();
    channelRef.current?.send({
      type: "broadcast",
      event: "seno",
      payload: { seno_at: senoAt, group },
    });
    onSenoRef.current(senoAt, group); // 自分にも届ける（self:false のため）
  }, []);

  /** ✋を押した（ready）を送る */
  const sendReady = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "ready",
      payload: { session_id: presenceKeyRef.current },
    });
    onReadyRef.current(presenceKeyRef.current); // 自分の ready も集計に入れる
  }, []);

  /** ホストが曲開始の基準点を配る。t0=ホスト時計ms, p0=動画位置秒 */
  const sendSongStart = useCallback((t0: number, p0: number) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "songstart",
      payload: { t0, p0 },
    });
    onSongStartRef.current(t0, p0);
  }, []);

  /** ホストがせーの失敗を全員に伝える */
  const sendSenoFail = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "seno-fail", payload: {} });
    onSenoFailRef.current();
  }, []);

  /** タップを全員に送る（再生中） */
  const broadcastTap = useCallback((videoTime: number) => {
    const ch = channelRef.current;
    const mid = memberId;
    if (!ch || !mid) return;
    const idx = frozenSeatIndexRef.current;
    if (idx < 0) return;
    const now = Date.now();
    if (now - lastTapBroadcastAtRef.current < TAP_BROADCAST_MIN_INTERVAL_MS) return;
    lastTapBroadcastAtRef.current = now;
    ch.send({
      type: "broadcast",
      event: "tap",
      payload: {
        session_id: presenceKeyRef.current,
        member_id: mid,
        seat_index: idx,
        video_time: videoTime,
      },
    });
  }, [memberId]);

  /** 待機室でドットを跳ねさせる合図 */
  const broadcastBounce = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "bounce",
      payload: { session_id: presenceKeyRef.current },
    });
  }, []);

  return {
    participants,
    presenceKey: presenceKeyRef.current,
    mySeatIndex,
    isHost,
    connected,
    channelError,
    getClockOffset,
    sendSeno,
    sendReady,
    sendSongStart,
    sendSenoFail,
    broadcastTap,
    broadcastBounce,
  };
}
