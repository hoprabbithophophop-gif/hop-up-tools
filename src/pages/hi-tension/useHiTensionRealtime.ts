import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const CHANNEL_BASE = "hi-tension";
export const START_DELAY_MS = 3000;

// 「みんなで」待機室の参加上限。seat_index 0〜3 が正規参加者。
export const MAX_PARTICIPANTS = 4;

// tap broadcast の最小送信間隔（≒13回/秒上限）。長押し(150ms間隔)・人力連打では
// 発動しない高めの値。ボタン暴走バグ等の異常送信を頭打ちにするための安全キャップ。
const TAP_BROADCAST_MIN_INTERVAL_MS = 75;

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
 * - 部屋: roomCode が null ならグローバル部屋、文字列なら `hi-tension:CODE` の専用部屋。
 *   roomCode が変わるとチャンネルを張り直す。
 * - 待機登録は宣言的: inWaitingRoom が true の間だけ自分を presence に track する。
 *   チャンネル切替後も subscribe 完了時に自動で track し直す。
 * - 再生中: broadcastTap / onTap
 */
export function useHiTensionRealtime({
  sessionId,
  memberId,
  roomCode,
  inWaitingRoom,
  onStart,
  onTap,
  onBounce,
}: {
  sessionId: string;
  memberId: string | null;
  roomCode: string | null;
  inWaitingRoom: boolean;
  onStart: (startAt: number) => void;
  onTap: (tap: LiveTap) => void;
  onBounce?: (bounce: LiveBounce) => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connected, setConnected] = useState(false);
  const [channelError, setChannelError] = useState(false);

  // Presence キーはタブごとに一意（同じブラウザの複数タブで localStorage の sessionId が
  // 被っても Presence が上書きされないよう、マウント時にランダムサフィックスを付与する）
  const presenceKeyRef = useRef(`${sessionId}-${Math.random().toString(36).slice(2, 8)}`);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const onStartRef = useRef(onStart);
  const onTapRef = useRef(onTap);
  const onBounceRef = useRef(onBounce);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
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

  // tap broadcast の安全キャップ用: 最後に送信した時刻
  const lastTapBroadcastAtRef = useRef<number>(0);

  // untrack 後も席番を使えるよう最後の有効値を保持する
  const frozenSeatIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (mySeatIndex >= 0) frozenSeatIndexRef.current = mySeatIndex;
  }, [mySeatIndex]);

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
      .on("broadcast", { event: "start" }, ({ payload }) => {
        // 偽の遠未来 start_at でカウントダウンに釘付けにされるのを防ぐ
        if (typeof payload?.start_at === "number" && payload.start_at <= Date.now() + 60000) {
          onStartRef.current(payload.start_at);
        }
      })
      .on("broadcast", { event: "bounce" }, ({ payload }) => {
        if (typeof payload?.session_id === "string") {
          onBounceRef.current?.({ sessionId: payload.session_id });
        }
      })
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
          // チャンネル切替後でも、待機中ならこのタイミングで track し直す
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

  // 待機登録/解除（宣言的）: inWaitingRoom の変化に追従して track / untrack する。
  // チャンネル切替直後（未subscribe）は subscribe コールバック側で track されるのでスキップ。
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

  /**
   * スタートシグナルを全員に送る（ホスト専用）。
   * self: false のため自分には届かないので、自分の onStart も直接呼ぶ。
   */
  const broadcastStart = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const startAt = Date.now() + START_DELAY_MS;
    ch.send({ type: "broadcast", event: "start", payload: { start_at: startAt } });
    onStartRef.current(startAt); // 自分にも届ける
  }, []);

  /**
   * タップを全員に送る（再生中）。
   * 自分の seat_index は frozenSeatIndexRef（untrack 後も保持）から取る。
   */
  const broadcastTap = useCallback((videoTime: number) => {
    const ch = channelRef.current;
    const mid = memberId;
    if (!ch || !mid) return;
    const idx = frozenSeatIndexRef.current;
    if (idx < 0) return;
    // 安全キャップ: 異常な高頻度送信を頭打ちにする（ローカル記録・自分の✋は呼び出し元で別途処理済み）
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

  /** 待機室でドットを跳ねさせる合図を全員に送る */
  const broadcastBounce = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "bounce",
      payload: { session_id: presenceKeyRef.current },
    });
    // self: false なので自分には届かない → 呼び出し元でローカル処理する
  }, []);

  return {
    participants,
    presenceKey: presenceKeyRef.current,
    mySeatIndex,
    isHost,
    connected,
    channelError,
    broadcastStart,
    broadcastTap,
    broadcastBounce,
  };
}
