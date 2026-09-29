/**
 * 同期（カレンダー購読）の設定値の置き場と、変更の「合図」。
 *
 * ■ なぜこのファイルがあるか
 * 設定値そのものは同期画面が持っているが、保存の係は「どの画面を開いていても動く」
 * 必要がある（カレンダー画面で入金済みにしても届かない不具合があった）。
 * そこで、値の読み書きをこのファイルに集約し、書き換わったら合図を出すようにした。
 * 保存の係（useSubscriptionSaver）は合図を受けて、ここから値を読んで送る。
 *
 * ■ 将来の移行について（重要）
 * 本来は設定値を親の階層へ引き上げるのが素直な形で、いずれそうする想定。
 * そのとき差し替えるのは「このファイルの中身だけ」で済むように、
 * 外からは read/write/onChange の3つの入口しか使わせていない。
 * 呼び出し側が localStorage を直接触らないこと。ここが崩れると移行が難しくなる。
 */
import type { EventLeadSetting, RetentionMode } from "../../lib/icsCore";

// ─── 保存先のキー（このファイルの外からは触らない） ───────────────
const KEY_SLUG = "fc-sub-slug";
const KEY_RETENTION = "fc-sub-retention";
const KEY_INCLUDED = "fc-sub-included";
/** 利用者が自分で外した予定のid。自動で足す処理はこれを飛ばす（端末の中だけ・サーバーには送らない） */
const KEY_DISMISSED = "fc-sub-dismissed";
/** 「気になる」にしたことで同期に入れた予定のid。気になるを外した時に、これだけをまとめて外す（端末の中だけ） */
const KEY_WATCH_ADDED = "fc-sub-watch-added";
const KEY_EVENT_LEAD = "fc-sub-event-lead2";
const KEY_EVENT_LEAD_OLD = "fc-sub-event-lead"; // 旧形式("PT3H"/"P1D"/"none")
const KEY_EVENT_LEAD_OVR = "fc-sub-event-lead-ovr";
/** 最後に「サーバーへ送信が成功した」ときの内容の指紋。次に開いたとき未送信を見つけるために残す */
const KEY_LAST_SAVED_SIG = "fc-sub-last-saved-sig";
/** 最後に送信が成功した日時（ミリ秒）。サーバーは最後の更新から1年で同期を消すので、開いている人の分は途中で送り直す */
const KEY_LAST_SAVED_AT = "fc-sub-last-saved-at";
/** これより前に送ったきりなら、内容が同じでも送り直してサーバーの「最後の更新」を新しくする */
const RESEND_AFTER_MS = 30 * 24 * 3600 * 1000;

export const DEFAULT_EVENT_LEAD: EventLeadSetting = { hours: 3, dayBefore: false };

export interface SubscriptionInputs {
  slug: string | null;
  retention: RetentionMode;
  eventLead: EventLeadSetting;
  eventLeadOverrides: Record<string, EventLeadSetting>;
  includedIds: string[];
}

// ─── 読み取り ────────────────────────────────────────────────

function readSlug(): string | null {
  try { return localStorage.getItem(KEY_SLUG); } catch { return null; }
}

function readRetention(): RetentionMode {
  try {
    const v = localStorage.getItem(KEY_RETENTION);
    if (v === "after-event-1m" || v === "6m" || v === "forever") return v;
  } catch { /* ignore */ }
  return "after-event-1m";
}

/** 旧形式("PT3H"/"P1D"/"none")からの引き継ぎ込みで読み込む */
export function readEventLead(): EventLeadSetting {
  try {
    const v = localStorage.getItem(KEY_EVENT_LEAD);
    if (v) {
      const p = JSON.parse(v);
      if ((p.hours === null || (typeof p.hours === "number" && p.hours >= 1 && p.hours <= 24)) && typeof p.dayBefore === "boolean") {
        return { hours: p.hours, dayBefore: p.dayBefore };
      }
    }
    const old = localStorage.getItem(KEY_EVENT_LEAD_OLD);
    if (old === "P1D") return { hours: null, dayBefore: true };
    if (old === "none") return { hours: null, dayBefore: false };
    const m = old?.match(/^PT(\d+)H$/);
    if (m) return { hours: Number(m[1]), dayBefore: false };
  } catch { /* ignore */ }
  return DEFAULT_EVENT_LEAD;
}

/** 公演ごとの上書き設定（キー=eventTwinKey）。遠征公演だけ余裕を持たせる等に使う */
export function readEventLeadOverrides(): Record<string, EventLeadSetting> {
  try { return JSON.parse(localStorage.getItem(KEY_EVENT_LEAD_OVR) ?? "{}"); } catch { return {}; }
}

export function readIncludedIds(): string[] {
  try {
    const saved = localStorage.getItem(KEY_INCLUDED);
    if (saved) {
      const v = JSON.parse(saved);
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    }
  } catch { /* ignore */ }
  return [];
}

export function readDismissedIds(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_DISMISSED) ?? "[]");
    if (Array.isArray(v)) return new Set(v.filter((x): x is string => typeof x === "string"));
  } catch { /* ignore */ }
  return new Set();
}

/** 保存の係が送信直前に読む。画面の状態ではなく、ここが唯一の正とする */
export function readInputs(): SubscriptionInputs {
  return {
    slug: readSlug(),
    retention: readRetention(),
    eventLead: readEventLead(),
    eventLeadOverrides: readEventLeadOverrides(),
    includedIds: readIncludedIds(),
  };
}

/** 未保存の判定に使う印。保存の係が「送信成功したとき」だけ書き換える */
export function readLastSavedSig(): string | null {
  try {
    const at = Number(localStorage.getItem(KEY_LAST_SAVED_AT));
    // 送った日時が無い・古い時は「未送信」として扱い、同じ内容を送り直させる
    if (!at || Date.now() - at > RESEND_AFTER_MS) return null;
    return localStorage.getItem(KEY_LAST_SAVED_SIG);
  } catch { return null; }
}

// ─── 書き込み（すべて合図を出す） ─────────────────────────────

/** 設定値が書き換わったことを知らせる合図。保存の係だけが聞いている */
const CHANGE_EVENT = "fc-subscription-inputs-changed";

function notifyChanged() {
  try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch { /* ignore */ }
}

/** 合図を聞く。戻り値を呼ぶと聞くのをやめる */
export function onInputsChanged(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

function writeRaw(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

export function writeSlug(slug: string | null) {
  writeRaw(KEY_SLUG, slug);
  notifyChanged();
}

export function writeRetention(retention: RetentionMode) {
  writeRaw(KEY_RETENTION, retention);
  notifyChanged();
}

export function writeIncludedIds(ids: Iterable<string>) {
  writeRaw(KEY_INCLUDED, JSON.stringify([...ids]));
  notifyChanged();
}

export function readWatchAddedIds(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_WATCH_ADDED) ?? "[]");
    if (Array.isArray(v)) return new Set(v.filter((x): x is string => typeof x === "string"));
  } catch { /* ignore */ }
  return new Set();
}

/** 送信内容ではないので合図を出さない */
export function writeWatchAddedIds(ids: Iterable<string>) {
  writeRaw(KEY_WATCH_ADDED, JSON.stringify([...ids]));
}

/** 外した記録は送信内容ではないので合図を出さない */
export function writeDismissedIds(ids: Iterable<string>) {
  writeRaw(KEY_DISMISSED, JSON.stringify([...ids]));
}

export function writeEventLead(lead: EventLeadSetting) {
  writeRaw(KEY_EVENT_LEAD, JSON.stringify(lead));
  notifyChanged();
}

export function writeEventLeadOverrides(ovr: Record<string, EventLeadSetting>) {
  writeRaw(KEY_EVENT_LEAD_OVR, JSON.stringify(ovr));
  notifyChanged();
}

/** 送信が成功したときだけ呼ぶ。ここを送信前に呼ぶと、失敗した変更が「送信済み」になって永久に消える */
export function writeLastSavedSig(sig: string | null) {
  writeRaw(KEY_LAST_SAVED_SIG, sig);
  writeRaw(KEY_LAST_SAVED_AT, sig === null ? null : String(Date.now()));
}

/** 同期をやめたとき用。設定値は残し、購読URLと保存済みの印だけ消す */
export function clearPublished() {
  writeRaw(KEY_SLUG, null);
  writeRaw(KEY_LAST_SAVED_SIG, null);
  writeRaw(KEY_LAST_SAVED_AT, null);
  notifyChanged();
}

// ─── 前の同期URLからの引き継ぎ ─────────────────────────────────

/**
 * 同期URLの引き継ぎで受け取った「行く公演」の news_uid。
 * 当選・未入金の公演は貼り付けた文が無いと判定できないので、引き継いだ直後の保存で
 * 出発の通知が消えないよう、これも「行く」に含める（computeAttendingNewsUids が読む）
 */
const KEY_ATTENDING_RESTORED = "fc-attending-restored";

export function readAttendingRestored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_ATTENDING_RESTORED) ?? "[]");
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  } catch { /* ignore */ }
  return [];
}

/** 送信内容の材料だが、書いた直後に送信済みの印を消して読み込み直すので合図は出さない */
export function writeAttendingRestored(uids: Iterable<string>) {
  writeRaw(KEY_ATTENDING_RESTORED, JSON.stringify([...uids]));
}

/**
 * 引き継ぎ・バックアップの読み込みのあと、画面を読み込み直す。
 * 読み込み直しの瞬間（pagehide）に保存の係が送ると、画面がまだ持っている古い「入金済み」「気になる」と
 * 新しい同期URLが混ざった内容を送ってしまう。読み込み直した後に正しい内容で送り直すので、ここでは送らせない。
 */
let reloadPending = false;

export function isReloadPending(): boolean {
  return reloadPending;
}

export function reloadAfterRestore() {
  reloadPending = true;
  writeLastSavedSig(null); // 次に開いた時に必ず送り直す
  location.reload();
}

const RETENTION_VALUES: RetentionMode[] = ["after-event-1m", "6m", "forever"];

function isEventLeadSetting(v: unknown): v is EventLeadSetting {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const hoursOk = o.hours === null || (typeof o.hours === "number" && o.hours >= 1 && o.hours <= 24);
  return hoursOk && typeof o.dayBefore === "boolean";
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * 読み戻した設定のうち、この置き場が持つ分を端末に書く。
 * 選んだ予定は端末の今の選択に足す。保持期限・通知の設定は読み戻した値で上書きする
 */
export function applyRestoredSubscription(slug: string, order: {
  includedIds?: unknown;
  retention?: unknown;
  eventLead?: unknown;
  eventLeadOverrides?: unknown;
  attendingNewsUids?: unknown;
}) {
  writeRaw(KEY_SLUG, slug);
  writeRaw(KEY_INCLUDED, JSON.stringify([...new Set([...readIncludedIds(), ...strings(order.includedIds)])]));
  if (typeof order.retention === "string" && (RETENTION_VALUES as string[]).includes(order.retention)) {
    writeRaw(KEY_RETENTION, order.retention);
  }
  if (isEventLeadSetting(order.eventLead)) writeRaw(KEY_EVENT_LEAD, JSON.stringify(order.eventLead));
  if (typeof order.eventLeadOverrides === "object" && order.eventLeadOverrides !== null) {
    const ovr: Record<string, EventLeadSetting> = {};
    for (const [k, v] of Object.entries(order.eventLeadOverrides as Record<string, unknown>)) {
      if (isEventLeadSetting(v)) ovr[k] = v;
    }
    writeRaw(KEY_EVENT_LEAD_OVR, JSON.stringify(ovr));
  }
  writeAttendingRestored(strings(order.attendingNewsUids));
}
