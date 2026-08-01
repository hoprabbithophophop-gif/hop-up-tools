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
const KEY_EVENT_LEAD = "fc-sub-event-lead2";
const KEY_EVENT_LEAD_OLD = "fc-sub-event-lead"; // 旧形式("PT3H"/"P1D"/"none")
const KEY_EVENT_LEAD_OVR = "fc-sub-event-lead-ovr";
/** 最後に「サーバーへ送信が成功した」ときの内容の指紋。次に開いたとき未送信を見つけるために残す */
const KEY_LAST_SAVED_SIG = "fc-sub-last-saved-sig";

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
  try { return localStorage.getItem(KEY_LAST_SAVED_SIG); } catch { return null; }
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
}

/** 同期をやめたとき用。設定値は残し、購読URLと保存済みの印だけ消す */
export function clearPublished() {
  writeRaw(KEY_SLUG, null);
  writeRaw(KEY_LAST_SAVED_SIG, null);
  notifyChanged();
}
