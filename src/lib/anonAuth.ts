import { getSupabase } from "./supabase";

/**
 * 名前を出さないまま書き込めるようにするための入場手続き。
 *
 * 【いつ通すか】
 * 見るだけの人は通さない。**最初に書き込む直前だけ**通す。
 * 早めに通しておくと、見るだけの人まで入場済みになってしまい、
 * 既存のページ（/youtube・/fc-ticket など）の見え方に影響する範囲が広がる。
 *
 * 【人間確認について】
 * 入場には人間確認の合図（トークン）が要る。これはHopがCloudflare側で
 * 設定したもので、合図が無いと入場そのものが弾かれる（実測で確認済み）。
 */

/** すでに入場済みか */
export async function hasSession(): Promise<boolean> {
  const { data } = await getSupabase().auth.getSession();
  return !!data.session;
}

/** 人間確認の合図を添えて入場する */
export async function signInAnonymously(captchaToken: string): Promise<void> {
  const { error } = await getSupabase().auth.signInAnonymously({
    options: { captchaToken },
  });
  if (error) throw error;
}

/**
 * 書き込みの直前に呼ぶ。まだ入場していなければ、人間確認を出してもらう。
 * `askForToken` は画面側が用意する（人間確認の部品を出して、合図を返す）。
 */
export async function ensureCanWrite(askForToken: () => Promise<string | null>): Promise<boolean> {
  if (await hasSession()) return true;
  const token = await askForToken();
  if (!token) return false; // 人間確認をやめた
  await signInAnonymously(token);
  return true;
}
