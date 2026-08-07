import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import { BUILT_IN_SONGS } from "./builtInSongs";

/**
 * コール情報集約センター — 曲の一覧。
 *
 * いまは曲が10曲しかないので、経路を分けず全部並べる。
 * 公演から辿る導線は、公演データの整形が済んでから足す。
 */

type Song = {
  id: string;
  slug: string;
  title: string;
  group_name: string;
  bpm: number | null;
};

export default function CallCenterPage() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .from("song_structures")
      .select("id, slug, title, group_name, bpm")
      .order("group_name", { ascending: true })
      .order("title", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setSongs((data as Song[]) ?? []);
      });
  }, []);

  const byGroup = new Map<string, Song[]>();
  // まだ棚に入れていない曲（アプリに同梱しているもの）も一緒に並べる
  for (const b of BUILT_IN_SONGS) {
    byGroup.set(b.groupName, [
      { id: b.slug, slug: b.slug, title: b.title, group_name: b.groupName, bpm: b.bpm },
    ]);
  }
  for (const s of songs ?? []) {
    const list = byGroup.get(s.group_name) ?? [];
    list.push(s);
    byGroup.set(s.group_name, list);
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.eyebrow}>CALL CENTER</div>
        <h1 style={S.h1}>コール情報集約センター</h1>
        <p style={S.lede}>
          現場で聞こえたコールを持ち寄って、曲の目盛りの上に置いていく場所です。
          正解を決める場ではなく、観測を集める場です。
        </p>

        {error && <div style={S.notice}>読み込みに失敗しました（{error}）</div>}

        {songs === null && !error && <div style={S.notice}>読み込み中…</div>}

        {songs !== null && songs.length === 0 && (
          <div style={S.notice}>まだ曲がありません。</div>
        )}

        {[...byGroup.entries()].map(([group, list]) => (
          <section key={group} style={S.section}>
            <h2 style={S.h2}>{group}</h2>
            <div style={S.grid}>
              {list.map((s) => (
                <Link key={s.id} to={`/call-center/song/${s.slug}`} style={S.card}>
                  <div style={S.cardTitle}>{s.title}</div>
                  <div style={S.cardMeta}>
                    {s.bpm ? `BPM ${Math.round(Number(s.bpm))}` : ""}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <p style={S.foot}>
          ハロー！プロジェクトの非公式ファンツールです。運営は公式とは関係ありません。
        </p>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { background: "#f8f9fa", minHeight: "100vh", color: "#000" },
  wrap: { maxWidth: 880, margin: "0 auto", padding: "40px 20px 96px" },
  eyebrow: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.22em",
    color: "#585f6c",
  },
  h1: { fontSize: 30, fontWeight: 900, lineHeight: 1.25, margin: "8px 0 10px" },
  lede: { fontSize: 14, lineHeight: 1.9, color: "#585f6c", margin: 0, maxWidth: 620 },
  section: { marginTop: 40 },
  h2: { fontSize: 16, fontWeight: 900, margin: "0 0 10px" },
  grid: { display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" },
  card: {
    display: "block",
    background: "#fff",
    padding: "16px 18px",
    textDecoration: "none",
    color: "inherit",
  },
  cardTitle: { fontSize: 15, fontWeight: 900, lineHeight: 1.4 },
  cardMeta: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    color: "#585f6c",
    marginTop: 6,
  },
  notice: { background: "#fff", padding: "16px 18px", fontSize: 14, marginTop: 24 },
  foot: { fontSize: 12, color: "#585f6c", marginTop: 56, lineHeight: 1.8 },
};
