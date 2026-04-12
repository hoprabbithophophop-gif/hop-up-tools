/**
 * 診断用エンドポイント: /ogp/diag
 * 確認後に削除する。
 */
import { fetchOgpData } from '../_shared/ogp';

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { env } = context;

  const hasUrl = !!env.VITE_SUPABASE_URL;
  const hasKey = !!env.VITE_SUPABASE_ANON_KEY;
  const urlLen = env.VITE_SUPABASE_URL?.length ?? 0;
  const keyLen = env.VITE_SUPABASE_ANON_KEY?.length ?? 0;
  const keyPrefix = env.VITE_SUPABASE_ANON_KEY?.slice(0, 10) ?? '';

  const result: Record<string, unknown> = {
    env: {
      VITE_SUPABASE_URL: { exists: hasUrl, length: urlLen },
      VITE_SUPABASE_ANON_KEY: { exists: hasKey, length: keyLen, prefix: keyPrefix },
    },
  };

  if (!hasUrl || !hasKey) {
    result.supabase = { skipped: 'env vars missing' };
    return Response.json(result);
  }

  // 実際に Supabase REST を直叩きして確認
  const endpoint =
    `${env.VITE_SUPABASE_URL}/rest/v1/playlist_shares` +
    `?id=eq.PB5Yglf1&select=title,items&limit=1`;

  let rawStatus: number | null = null;
  let rawBody: unknown = null;
  let fetchError: string | null = null;

  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    });
    rawStatus = res.status;
    const text = await res.text();
    try { rawBody = JSON.parse(text); } catch { rawBody = text.slice(0, 200); }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  result.rawFetch = { status: rawStatus, body: rawBody, error: fetchError };

  // fetchOgpData 経由でも確認
  let ogpResult: unknown = null;
  let ogpError: string | null = null;
  try {
    ogpResult = await fetchOgpData('PB5Yglf1', env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
  } catch (e) {
    ogpError = e instanceof Error ? e.message : String(e);
  }

  result.fetchOgpData = {
    result: ogpResult === null ? 'null' : 'object',
    data: ogpResult,
    error: ogpError,
  };

  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
