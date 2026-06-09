import { nanoid } from "nanoid";

const KEY_MEMBER = "hi_tension:last_selected_member_id";
const KEY_SESSION = "hi_tension:anonymous_session_id";
const KEY_HAS_COMPLETED = "hi_tension:has_completed";
const KEY_SETTINGS = "hi_tension:settings";

/**
 * 表示設定（ユーザー任意）。重い端末・集中したい人向けのopt-in。
 * 既定は「満員＋ヒートマップ表示＋通常モーション」＝今までの見え方そのまま。
 * - crowd: 群衆✋の量。full=満員(既定) / light=控えめ / self=自分だけ(1人イメトレ)
 * - heatmap: 盛り上がりタイムラインを出すか
 * - reduceMotion: ✋の跳ねる演出・ステージ照明の明滅を止める（軽量＋酔い対策）
 */
export type HiCrowdLevel = "full" | "light" | "self";
export type HiSettings = {
  crowd: HiCrowdLevel;
  heatmap: boolean;
  reduceMotion: boolean;
};

export const DEFAULT_HI_SETTINGS: HiSettings = {
  crowd: "full",
  heatmap: true,
  reduceMotion: false,
};

/** 「かるくする」プリセット＝重い端末向けに3項目をまとめて軽量側へ。 */
export const LIGHT_HI_SETTINGS: HiSettings = {
  crowd: "light",
  heatmap: false,
  reduceMotion: true,
};

export function getHiSettings(): HiSettings {
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_HI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<HiSettings>;
    // 未知の保存値・欠損は既定で補完（壊れた値で画面が消えないように）。
    const crowd: HiCrowdLevel =
      parsed.crowd === "light" || parsed.crowd === "self" ? parsed.crowd : "full";
    return {
      crowd,
      heatmap: typeof parsed.heatmap === "boolean" ? parsed.heatmap : true,
      reduceMotion: typeof parsed.reduceMotion === "boolean" ? parsed.reduceMotion : false,
    };
  } catch {
    return { ...DEFAULT_HI_SETTINGS };
  }
}

export function setHiSettings(settings: HiSettings): void {
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
  } catch {
    // ignore (private mode etc.)
  }
}

export function getLastSelectedMemberId(): string | null {
  try {
    return localStorage.getItem(KEY_MEMBER);
  } catch {
    return null;
  }
}

export function setLastSelectedMemberId(id: string): void {
  try {
    localStorage.setItem(KEY_MEMBER, id);
  } catch {
    // ignore (private mode etc.)
  }
}

/**
 * 動画完走を一度でも経験したか。
 * 初回プレイは「ソロモード」(過去✋を表示しない)のデフォルトに使う。
 */
export function getHasCompleted(): boolean {
  try {
    return localStorage.getItem(KEY_HAS_COMPLETED) === "1";
  } catch {
    return false;
  }
}

export function markHasCompleted(): void {
  try {
    localStorage.setItem(KEY_HAS_COMPLETED, "1");
  } catch {
    // ignore
  }
}

export function getOrCreateAnonymousSessionId(): string {
  try {
    const existing = localStorage.getItem(KEY_SESSION);
    if (existing) return existing;
    const fresh = nanoid();
    localStorage.setItem(KEY_SESSION, fresh);
    return fresh;
  } catch {
    return nanoid();
  }
}
