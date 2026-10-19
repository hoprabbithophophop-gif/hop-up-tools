// X・Instagram の URL からアカウント名を読む（棚もサーバーも触らない純粋な関数）。
// ヒントの札「公式サイトに載っているアカウント／載っていないアカウント」の判定に使う（Hop 決定 2026-10-19）。
// 注意: URL に書かれたアカウント名を読むだけで、その投稿が本当にそのアカウントの物かは確かめていない（札は証明ではない）。
import { isListedAccount, type SocialService } from "../../data/officialAccounts";

export interface SocialAccount {
  service: SocialService;
  handle: string;
}

// アカウント名の場所に来ない、サービス側の決まった言葉
const X_RESERVED = new Set(["i", "home", "search", "explore", "hashtag", "intent", "settings", "messages", "notifications", "compose", "login", "share"]);
const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct"]);

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const IG_HANDLE = /^[A-Za-z0-9_.]{1,30}$/;

// 読めない形（x.com/i/web/status/…、instagram.com/p/…）は null。その時は札を出さない
export function accountOfUrl(input: string): SocialAccount | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|mobile\.)/, "");
  const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (host === "x.com" || host === "twitter.com") {
    if (!first || X_RESERVED.has(first.toLowerCase()) || !X_HANDLE.test(first)) return null;
    return { service: "x", handle: first };
  }
  if (host === "instagram.com" || host === "instagr.am") {
    if (!first || IG_RESERVED.has(first.toLowerCase()) || !IG_HANDLE.test(first)) return null;
    return { service: "ig", handle: first };
  }
  return null;
}

export type ListedTag = { handle: string; listed: boolean };

export function listedTagOfUrl(input: string): ListedTag | null {
  const acct = accountOfUrl(input);
  if (!acct) return null;
  return { handle: acct.handle, listed: isListedAccount(acct.service, acct.handle) };
}
