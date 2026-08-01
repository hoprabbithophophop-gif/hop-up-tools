/**
 * 同期（カレンダー購読）の保存の係。
 *
 * ■ 置き場所
 * 画面のどこにいても働く必要があるので、常に動いている親（FcTicketPage）で1回だけ呼ぶ。
 * 以前は同期画面の中にいたため、カレンダー画面で付けた「入金済み」が届かなかった。
 *
 * ■ 設計の芯（このツールの哲学：壊れたら静かに消えるのではなく、鳴りすぎる側に倒す）
 * - 「送信済み」の印は、サーバーへの送信が成功したときだけ書き換える。
 *   画面を開いた瞬間に印を引き直すと、まだ送っていない変更が「送った扱い」になって永久に消える。
 * - 送信に失敗したら、未送信のまま保持して自動で再試行する。黙って諦めない。
 * - 印は端末に残すので、ページを閉じて開き直しても未送信を見つけて送り直せる。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchResult } from "../../lib/parseUpfcText";
import type { OrderTicket } from "../../lib/icsCore";
import { uploadSubscriptionIcs } from "../../lib/icsSubscription";
import { onInputsChanged, readInputs, readLastSavedSig, writeLastSavedSig } from "./subscriptionStore";

/** fc_deadlines.id はUUID。画面だけの疑似的な行を注文票に載せない（載せると発行が丸ごと失敗する） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEBOUNCE_MS = 2000;
/** 失敗したときの再試行の間隔。だんだん延ばして、諦めはしない */
const RETRY_DELAYS_MS = [5000, 15000, 60000, 300000];

export type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * 「行く」と判定された news_uid（当選 or 入金済）。
 * 貼り付けテキストの中身ではなく、この判定結果(○×)だけを注文票に含める
 * （サーバーには生テキストを送らない約束を維持する）。
 */
export function computeAttendingNewsUids(matchResultsList: MatchResult[], paidList: string[]): string[] {
  const attending = new Set(paidList);
  for (const r of matchResultsList) {
    const st = r.parsed.status;
    if (!(st.includes("入金済") || (st.includes("当選") && !st.includes("当選取消")))) continue;
    for (const m of r.matched) attending.add(m.uid);
  }
  return [...attending].sort();
}

/**
 * 「入金が済んだ」公演だけを集める。
 * attendingNewsUids は当選も入金済も混ぜた「行く公演」なので、
 * 入金締切の予定を【入金済み】に書き換えるにはこちらを別に持つ必要がある。
 */
export function computePaidNewsUids(matchResultsList: MatchResult[], paidList: string[]): string[] {
  const paidSet = new Set(paidList);
  for (const r of matchResultsList) {
    if (!r.parsed.status.includes("入金済")) continue;
    for (const m of r.matched) paidSet.add(m.uid);
  }
  return [...paidSet].sort();
}

/** いま送るべき注文票。送れない状態（未発行・対象ゼロ）なら null */
function buildOrder(matchResults: MatchResult[], paid: string[]): { slug: string; order: OrderTicket } | null {
  const inputs = readInputs();
  if (!inputs.slug) return null; // まだ発行していない＝送る先が無い
  const includedIds = inputs.includedIds.filter((id) => UUID_RE.test(id));
  if (includedIds.length === 0) return null;
  return {
    slug: inputs.slug,
    order: {
      v: 2,
      includedIds,
      retention: inputs.retention,
      eventLead: inputs.eventLead,
      eventLeadOverrides: inputs.eventLeadOverrides,
      attendingNewsUids: computeAttendingNewsUids(matchResults, paid),
      paidNewsUids: computePaidNewsUids(matchResults, paid),
    },
  };
}

/** 内容の指紋。これが前回の送信成功時と違えば未送信 */
function signatureOf(built: { slug: string; order: OrderTicket } | null): string | null {
  if (!built) return null;
  const o = built.order;
  return [
    built.slug,
    o.includedIds.join(","),
    o.retention,
    JSON.stringify(o.eventLead),
    JSON.stringify(o.eventLeadOverrides),
    o.attendingNewsUids.join(","),
    (o.paidNewsUids ?? []).join(","),
  ].join("|");
}

export interface SubscriptionSaver {
  saveState: SaveState;
  /** 未送信の変更を抱えているか。画面に帯を出す判断に使う */
  hasUnsaved: boolean;
  /** 直近の失敗理由（画面表示用・無ければ null） */
  lastError: string | null;
  /** 「いま送る」ボタン用 */
  saveNow: () => void;
  /** 発行ボタンから使う。成功したら印を更新して true */
  saveImmediately: () => Promise<boolean>;
}

export function useSubscriptionSaver(matchResults: MatchResult[], paid: string[]): SubscriptionSaver {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // タイマーから最新値を読むためのref
  const matchResultsRef = useRef(matchResults); matchResultsRef.current = matchResults;
  const paidRef = useRef(paid); paidRef.current = paid;
  const timerRef = useRef<number | null>(null);
  const retryIndexRef = useRef(0);
  const inFlightRef = useRef(false);
  const savedToastTimerRef = useRef<number | null>(null);

  /** いま未送信かどうかを見て、画面表示を合わせる */
  const refreshUnsaved = useCallback(() => {
    const sig = signatureOf(buildOrder(matchResultsRef.current, paidRef.current));
    const unsaved = sig !== null && sig !== readLastSavedSig();
    setHasUnsaved(unsaved);
    return unsaved;
  }, []);

  const doSave = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false;
    const built = buildOrder(matchResultsRef.current, paidRef.current);
    const sig = signatureOf(built);
    if (!built || sig === null) { setHasUnsaved(false); return false; }
    if (sig === readLastSavedSig()) { setHasUnsaved(false); return true; } // 送る必要なし

    inFlightRef.current = true;
    setSaveState("saving");
    try {
      await uploadSubscriptionIcs(built.slug, built.order);
      // ★ 印を書き換えるのは、送信が成功したここだけ
      writeLastSavedSig(sig);
      retryIndexRef.current = 0;
      setLastError(null);
      setHasUnsaved(false);
      setSaveState("saved");
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
      savedToastTimerRef.current = window.setTimeout(() => setSaveState("idle"), 2000);
      return true;
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
      setHasUnsaved(true);
      setSaveState("failed");
      // 諦めずに間を空けて再試行（最後の間隔で打ち止めにせず繰り返す）
      const delay = RETRY_DELAYS_MS[Math.min(retryIndexRef.current, RETRY_DELAYS_MS.length - 1)];
      retryIndexRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { void doSave(); }, delay);
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  /** 変更を受けて、少し待ってから送る */
  const scheduleSave = useCallback(() => {
    if (!refreshUnsaved()) return;
    setSaveState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void doSave(); }, DEBOUNCE_MS);
  }, [doSave, refreshUnsaved]);

  // 設定値の変更（どの画面からでも）を受け取る
  useEffect(() => onInputsChanged(scheduleSave), [scheduleSave]);

  // 入金済み・貼り付け結果の変更を受け取る（これらは親が持っている状態）
  useEffect(() => { scheduleSave(); }, [paid, matchResults, scheduleSave]);

  // 起動時：前回送れなかった変更が残っていれば送り直す
  useEffect(() => {
    if (refreshUnsaved()) void doSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 離脱時（タブを閉じる・隠れる）に保留中を即送信
  useEffect(() => {
    function flush() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      void doSave();
    }
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    };
  }, [doSave]);

  const saveNow = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    retryIndexRef.current = 0;
    void doSave();
  }, [doSave]);

  return { saveState, hasUnsaved, lastError, saveNow, saveImmediately: doSave };
}
