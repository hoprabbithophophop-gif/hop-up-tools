/**
 * OGP 動的生成ユーティリティ
 * Cloudflare Pages Functions から呼び出す共通ロジック
 */

interface PlaylistShareItem {
  videoId: string;
  chapterTitle: string;
}

interface PlaylistShareRow {
  title: string;
  items: PlaylistShareItem[];
}

export interface OgpData {
  /** og:title 用（"... | CHAPTER PICKUP" 付き） */
  ogTitle: string;
  /** og:description 用（"1曲目 他N件"） */
  ogDescription: string;
  /** Phase 1 フォールバック用 YouTube サムネ URL */
  thumbnailUrl: string;
  /** 1曲目の YouTube video ID */
  videoId: string;
  /** テキストオーバーレイ用クリーンタイトル（suffix なし） */
  displayTitle: string;
}

/**
 * Supabase REST API でプレイリストを取得し OGP 用データを返す。
 * 取得失敗・プレイリスト不在の場合は null。
 */
export async function fetchOgpData(
  playlistId: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<OgpData | null> {
  const endpoint =
    `${supabaseUrl}/rest/v1/playlist_shares` +
    `?id=eq.${encodeURIComponent(playlistId)}` +
    `&select=title,items&limit=1`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const rows = (await res.json()) as PlaylistShareRow[];
  if (!rows.length || !rows[0].items.length) return null;

  const share = rows[0];
  const first = share.items[0];
  const count = share.items.length;

  const displayTitle = share.title || first.chapterTitle;
  const ogTitle = `${displayTitle} | CHAPTER PICKUP`;

  const ogDescription =
    count === 1
      ? first.chapterTitle
      : `${first.chapterTitle} 他 ${count - 1} チャプター`;

  const thumbnailUrl = `https://i.ytimg.com/vi/${first.videoId}/hqdefault.jpg`;

  return {
    ogTitle,
    ogDescription,
    thumbnailUrl,
    videoId: first.videoId,
    displayTitle,
  };
}

/** HTML 属性値のエスケープ */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** OGP / Twitter Card の <meta> タグ文字列を生成 */
export function buildMetaTags(opts: {
  canonicalUrl: string;
  title: string;
  description: string;
  image: string;
}): string {
  const { canonicalUrl, title, description, image } = opts;
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escAttr(canonicalUrl)}">`,
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(description)}">`,
    `<meta property="og:image" content="${escAttr(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escAttr(title)}">`,
    `<meta name="twitter:description" content="${escAttr(description)}">`,
    `<meta name="twitter:image" content="${escAttr(image)}">`,
  ].join('\n');
}
