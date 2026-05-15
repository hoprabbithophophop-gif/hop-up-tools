import { nanoid } from "nanoid";

const KEY_MEMBER = "hi_tension:last_selected_member_id";
const KEY_SESSION = "hi_tension:anonymous_session_id";
const KEY_HAS_COMPLETED = "hi_tension:has_completed";

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
