// YouTube の URL から動画番号と開始秒を読む。YouTube でなければ null
// 対応: watch?v= / youtu.be/ / shorts/ / embed/ / live/、時刻は t=83・t=83s・t=1m23s・t=1h2m3s・start=83
export interface ParsedYouTube {
  videoId: string;
  startSec: number;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

const parseTime = (raw: string | null): number => {
  if (!raw) return 0;
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
};

export function parseYouTubeUrl(input: string): ParsedYouTube | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  } else {
    return null;
  }
  if (!id || !ID.test(id)) return null;
  const startSec = parseTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return { videoId: id, startSec };
}

export const formatTime = (sec: number): string => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// 「1:23」「83」などの手入力を秒に直す。読めなければ null
export const parseTimeInput = (raw: string): number | null => {
  const t = raw.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const parts = t.split(":").map(p => (/^\d+$/.test(p) ? parseInt(p, 10) : NaN));
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};
