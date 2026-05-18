import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const CHANNEL = "hi-tension";
export const START_DELAY_MS = 3000;

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
 * - 待機室: trackPresence / untrackPresence / broadcastStart / participants
 * - 再生中: broadcastTap / onTap
 * チャンネルは1本なので接続は1回だけ。
 */
export function useHiTensionRealtime({
  sessionId,
  memberId,
  onStart,
  onTap,
  onBounce,
}: {
  sessionId: string;
  memberId: string | null;
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
  const onStartRef = useRef(onStart);
  const onTapRef = useRef(onTap);
  const onBounceRef = useRef(onBounce);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);
  useEffect(() => { onBounceRef.current = onBounce; }, [onBounce]);

  // 自分の seat_index とホスト判定（presenceKey で比較）
  const mySeatIndex = participants.findIndex(p => p.sessionId === presenceKeyRef.current);
  const isHost = mySeatIndex === 0 && participants.length > 0;

  useEffect(() => {
    const presenceKey = presenceKeyRef.current;
    const supabase = getSupabase();
    const channel = supabase.channel(CHANNEL, {
      config: {
        broadcast: { self: false },
        presence: { key: presenceKey },
      },
    });
    channelRef.current = channel;

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
        if (typeof payload?.start_at === "number") {
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
          typeof payload?.seat_index === "number" &&
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
          setConnected(true);
          setChannelError(false);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setChannelError(true);
          setConnected(false);
        }
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [sessionId]);

  /** 待機室に入るとき（memberId は呼び出し元から直接渡す） */
  const trackPresence = useCallback((mid: string) => {
    channelRef.current?.track({
      session_id: presenceKeyRef.current,
      member_id: mid,
      joined_at: Date.now(),
    });
  }, []);

  /** 待機室を出るとき（スタート後 or やっぱりひとりで） */
  const untrackPresence = useCallback(() => {
    channelRef.current?.untrack();
  }, []);

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
   * 自分の seat_index は participants リストから取る。
   */
  const broadcastTap = useCallback((videoTime: number) => {
    const ch = channelRef.current;
    const mid = memberId;
    if (!ch || !mid) return;
    const idx = participants.findIndex(p => p.sessionId === presenceKeyRef.current);
    if (idx < 0) return;
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
  }, [memberId, participants]);

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
    trackPresence,
    untrackPresence,
    broadcastStart,
    broadcastTap,
    broadcastBounce,
  };
}
