// X・Instagram の URL からアカウント名を読む（棚もサーバーも触らない純粋な関数）。
// ヒントの札「公式サイトに載っているアカウント／載っていないアカウント」の判定に使う（Hop 決定 2026-10-19）。
// 注意: URL に書かれたアカウント名を読むだけで、その投稿が本当にそのアカウントの物かは確かめていない（札は証明ではない）。
import { isListedAccount, type SocialService } from "../../data/officialAccounts";
import { OFFICIAL_SITES } from "../../data/officialSites";
import { BLOG_PERIODS, OFFICIAL_BLOGS } from "../../data/officialBlogs";

const OFFICIAL_BLOG_IDS = new Set([...OFFICIAL_BLOGS.flatMap((g) => g.ids), ...Object.keys(BLOG_PERIODS)].map((id) => id.toLowerCase()));

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

// リンクのヒントの行き先が、ハロプロの公式の住所か（Hop 決定 2026-10-23「公式でないリンクが、何も言われずにヒントになる」の直し）。
// 公式の住所は今ある一覧だけを使う: 公式サイトと関連サイト（officialSites.ts）・公式アメブロ（officialBlogs.ts の ID と、記事のある期間を測ったブログ）。
// X・Instagram は札（AccountTag）が名簿と照らすので、ここでは見ない（null を返す）。読めない住所も null
export function isOfficialSiteUrl(input: string): boolean | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) return null;
  if (host === "instagram.com" || host === "instagr.am" || host.endsWith(".instagram.com")) return null;
  if (OFFICIAL_SITES.some((s) => host === s || host.endsWith(`.${s}`))) return true;
  if (host === "ameblo.jp" || host === "s.ameblo.jp") {
    const id = (u.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
    return OFFICIAL_BLOG_IDS.has(id);
  }
  return false;
}
