import { nanoid } from "nanoid";

const KEY_MEMBER = "hi_tension:last_selected_member_id";
const KEY_SESSION = "hi_tension:anonymous_session_id";

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
