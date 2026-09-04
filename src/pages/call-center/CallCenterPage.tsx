import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import { BUILT_IN_SONGS } from "./builtInSongs";
import { loadLocalCalls } from "./localCalls";

/**
 * コール情報集約センター — 曲の一覧。
 *
 * いまは曲が10曲しかないので、経路を分けず全部並べる。
 * 公演から辿る導線は、公演データの整形が済んでから足す。
 */

/** 動画候補の1本。サムネイルの切り替え・複数動画があるときの選択表示に使う */
type SongVideo = { video_id: string; label: string | null };

type Song = {
  id: string;
  slug: string;
  title: string;
  group_name: string;
  bpm: number | null;
  /** 結び付いている動画。サムネイル表示・選択表示に使う。無ければ今までどおり画像を出さない */
  videos: SongVideo[];
};

/** サムネイル切り替え間隔（秒）の既定値。?thumb=<秒> で上書きできる仕掛けは残す（UIには出さない） */
const DEFAULT_THUMB_INTERVAL_SEC = 5;

function thumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * カード左のサムネイル（正方形）。動画が切り替わったら、新しい画像を右から入れて
 * 古い画像を左へ抜く横スライドで入れ替える（全カード共通のタイマーで動画自体は
 * 既に切り替わっている前提）。動画が1本しかない曲はそもそも呼ばれない側で弾く。
 */
function Thumb({ videoId }: { videoId: string }) {
  // 表示中の1枚（prev===nullのとき）と、切り替え中の新旧2枚（prev!==nullのとき）を持つ
  const [pair, setPair] = useState<{ current: string; prev: string | null }>({
    current: videoId,
    prev: null,
  });
  const [animating, setAnimating] = useState(false);
  const shownIdRef = useRef(videoId);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (videoId === shownIdRef.current) return;
    const old = shownIdRef.current;
    shownIdRef.current = videoId;

    setPair({ current: videoId, prev: old });
    setAnimating(false);
    if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);

    // 新旧2枚を初期位置（旧=中央、新=右外）で1度描かせてから、次フレームで
    // 旧を左外・新を中央へ動かす。1回のrequestAnimationFrameだとブラウザが
    // 初期位置の描画とまとめてしまいtransitionが走らないことがあるので2重に呼ぶ
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setAnimating(true));
    });
    cleanupTimerRef.current = setTimeout(() => {
      setPair((p) => ({ current: p.current, prev: null }));
      setAnimating(false);
    }, 380);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [videoId]);

  // アンマウント時の後片付け
  useEffect(() => () => {
    if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
  }, []);

  if (pair.prev === null) {
    return <img src={thumbUrl(pair.current)} alt="" style={S.thumbImg} />;
  }

  return (
    <>
      <img
        src={thumbUrl(pair.prev)}
        alt=""
        style={{ ...S.thumbImgSlide, transform: animating ? "translateX(-100%)" : "translateX(0)" }}
      />
      <img
        src={thumbUrl(pair.current)}
        alt=""
        style={{ ...S.thumbImgSlide, transform: animating ? "translateX(0)" : "translateX(100%)" }}
      />
    </>
  );
}

export default function CallCenterPage() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 曲ごとに、棚に入っているコールの数 */
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** 曲名の検索欄。空なら絞り込まない */
  const [query, setQuery] = useState("");
  /** グループの絞り込み。null＝全て */
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  /** 動画が2本以上ある曲のカードを開いて選択表示（A）にしているとき、そのslug。null＝どれも開いていない */
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const thumbIntervalSec = (() => {
    const raw = Number(searchParams.get("thumb"));
    return raw > 0 ? raw : DEFAULT_THUMB_INTERVAL_SEC;
  })();

  // サムネイルの動画切り替えは全カード共通の1本のタイマーで進める（バラバラにチカつかないように）
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), thumbIntervalSec * 1000);
    return () => clearInterval(id);
  }, [thumbIntervalSec]);

  useEffect(() => {
    // 棚に繋がらなくても、同梱している曲は出す。
    // ここで落ちると一覧ごと真っ白になり、唯一中身のある曲にも辿り着けなくなる。
    try {
      getSupabase()
        .from("song_structures")
        .select("id, slug, title, group_name, bpm, song_video_offsets(video_id, label)")
        .order("group_name", { ascending: true })
        .order("title", { ascending: true })
        .then(({ data, error }) => {
          if (error) { setError(error.message); return; }
          const rows = (data ?? []) as unknown as (Omit<Song, "videos"> & { song_video_offsets: SongVideo[] })[];
          setSongs(rows.map((r) => ({ ...r, videos: r.song_video_offsets })));
        });

      // 曲ごとのコール数。開く前に中身の有無が分かるようにする。
      getSupabase()
        .rpc("count_calls_by_song")
        .then(({ data }) => {
          if (!data) return;
          const m: Record<string, number> = {};
          for (const r of data as { slug: string; n: number }[]) m[r.slug] = Number(r.n);
          setCounts(m);
        });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setSongs([]);
    }
  }, []);

  /*
   * どの曲に中身があるかを、一覧の時点で分かるようにする。
   *
   * これが無いと、開いて空、開いて空、を繰り返すことになる。
   * いま11曲中10曲が空なので、当たりを引く前に帰ってしまう。
   */
  const countOf = (slug: string): number => {
    const fromShelf = counts[slug] ?? 0;
    if (fromShelf > 0) return fromShelf;
    const b = BUILT_IN_SONGS.find((x) => x.slug === slug && !x.inShelf);
    const mine = loadLocalCalls(slug).length;
    return mine > 0 ? mine : b ? b.calls.length : 0;
  };

  const byGroup = new Map<string, Song[]>();
  // まだ棚に入れていない曲（アプリに同梱しているもの）も一緒に並べる
  for (const b of BUILT_IN_SONGS.filter((x) => !x.inShelf)) {
    byGroup.set(b.groupName, [
      {
        id: b.slug, slug: b.slug, title: b.title, group_name: b.groupName, bpm: b.bpm,
        videos: b.videos.map((v) => ({ video_id: v.videoId, label: v.label })),
      },
    ]);
  }
  for (const s of songs ?? []) {
    const list = byGroup.get(s.group_name) ?? [];
    list.push(s);
    byGroup.set(s.group_name, list);
  }

  // 中身がある曲を、一覧の一等地に出す（検索・グループ絞り込みの影響を受けない固定の近道）
  const filled = [...byGroup.values()].flat()
    .map((s) => ({ song: s, n: countOf(s.slug) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  // チップに並べるグループ名（曲が来た順＝group_nameの五十音順）
  const groupNames = [...byGroup.keys()];

  const q = query.trim();
  const matchesQuery = (title: string) => q === "" || title.includes(q);

  // 検索・グループ絞り込みを適用した後の一覧（表示するグループだけ残す）
  const visibleGroups = [...byGroup.entries()]
    .filter(([group]) => groupFilter === null || group === groupFilter)
    .map(([group, list]) => [group, list.filter((s) => matchesQuery(s.title))] as const)
    .filter(([, list]) => list.length > 0);

  const isFiltering = groupFilter !== null || q !== "";

  /** カード本文（左サムネイル＋右の曲名・メタ行）の中身だけを組み立てる */
  const renderCardBody = (song: Song, metaText: string, metaStyle: React.CSSProperties) => (
    <div style={S.cardRow}>
      {song.videos.length > 0 && (
        <div style={S.thumbWrap}>
          <Thumb videoId={song.videos[tick % song.videos.length].video_id} />
        </div>
      )}
      <div style={S.cardBody}>
        <div style={S.cardTitle}>{song.title}</div>
        <div style={metaStyle}>{metaText}</div>
      </div>
    </div>
  );

  /**
   * 曲名の1枚のカード。動画が0〜1本なら今までどおりリンクで曲ページへ。
   * 2本以上ある曲はタップで選択表示（横長サムネイルの縦並び）を開く。
   */
  const renderSongCard = (song: Song, n: number, variant: "normal" | "on") => {
    const metaStyle = variant === "on" ? S.cardMetaOn : (n > 0 ? S.cardMetaHas : S.cardMeta);
    const metaText = variant === "on"
      ? `${song.group_name}　コール ${n}件`
      : (song.videos.length === 0 ? "まだ動画が結び付いていません" : n > 0 ? `コール ${n}件` : "コールはまだありません");
    const cardStyle = variant === "on" ? { ...S.card, ...S.cardOn } : S.card;

    if (song.videos.length < 2) {
      return (
        <Link key={song.id} to={`/call-center/song/${song.slug}/place`} style={cardStyle}>
          {renderCardBody(song, metaText, metaStyle)}
        </Link>
      );
    }

    if (openSlug === song.slug) {
      // 選択表示（A）: 横長サムネイルを動画の数だけ縦に並べる。曲名部分を押すと閉じる
      return (
        <div key={song.id} style={cardStyle}>
          <div style={S.cardTitle} onClick={() => setOpenSlug(null)}>{song.title}</div>
          <div style={S.videoPickList}>
            {song.videos.map((v) => (
              <Link
                key={v.video_id}
                to={`/call-center/song/${song.slug}/place?v=${v.video_id}`}
                style={S.videoPickItem}
              >
                <img src={thumbUrl(v.video_id)} alt="" style={S.videoPickImg} />
                {v.label && <div style={S.videoPickLabel}>{v.label}</div>}
              </Link>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div
        key={song.id}
        role="button"
        tabIndex={0}
        style={cardStyle}
        onClick={() => setOpenSlug(song.slug)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpenSlug(song.slug); }}
      >
        {renderCardBody(song, metaText, metaStyle)}
      </div>
    );
  };

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.eyebrow}>CALL CENTER</div>
        <h1 style={S.h1}>コール情報集約センター</h1>
        <p style={S.lede}>
          現場で聞こえたコールを持ち寄って、曲の目盛りの上に置いていく場所です。
          正解を決める場ではなく、観測を集める場です。
        </p>

        {/* 曲名の検索とグループの絞り込み。ページの入口に置き、下の近道・一覧どちらを
            探すときも最初に使える形にする（近道セクション自体は絞り込みの対象外＝固定表示）。
            曲数が増えても目当ての曲に辿り着けるようにする */}
        {groupNames.length > 0 && (
          <div style={S.filterBar}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="曲名で検索"
              style={S.searchInput}
            />
            <div style={S.chipRow}>
              <button
                type="button"
                style={groupFilter === null ? { ...S.chip, ...S.chipOn } : S.chip}
                onClick={() => setGroupFilter(null)}
              >全て</button>
              {groupNames.map((g) => (
                <button
                  key={g}
                  type="button"
                  style={groupFilter === g ? { ...S.chip, ...S.chipOn } : S.chip}
                  onClick={() => setGroupFilter(g)}
                >{g}</button>
              ))}
            </div>
          </div>
        )}

        {error && <div style={S.notice}>読み込みに失敗しました（{error}）</div>}

        {songs === null && !error && <div style={S.notice}>読み込み中…</div>}

        {songs !== null && songs.length === 0 && (
          <div style={S.notice}>まだ曲がありません。</div>
        )}

        {/* 中身のある曲への近道。検索・グループ絞り込みの対象外（固定表示）。
            ※見出しの文言は後から差し替える前提の仮置き */}
        {filled.length > 0 && (
          <section style={S.pickup}>
            <h2 style={S.pickupH}>コールが集まっている曲</h2>
            <div style={S.grid}>
              {filled.map(({ song, n }) => renderSongCard(song, n, "on"))}
            </div>
          </section>
        )}

        {isFiltering && visibleGroups.length === 0 && (
          <div style={S.notice}>この条件に合う曲は見つかりませんでした。</div>
        )}

        {visibleGroups.map(([group, list]) => (
          <section key={group} style={S.section}>
            <h2 style={S.h2}>{group}</h2>
            <div style={S.grid}>
              {list.map((s) => renderSongCard(s, countOf(s.slug), "normal"))}
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
    cursor: "pointer",
  },
  // カード本文（サムネイル＋曲名・メタ行）の並び
  cardRow: { display: "flex", alignItems: "center", gap: 12 },
  cardBody: { minWidth: 0, flex: "1 1 auto" },
  // サムネイル（正方形）。動画が無い曲は今までどおり画像を出さない
  thumbWrap: {
    width: 60, height: 60, flexShrink: 0, overflow: "hidden", background: "#e5e5e5",
    position: "relative",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  // 切り替え中の新旧2枚（横スライド用）。枠に重ねて敷き、transformだけで動かす
  thumbImgSlide: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "cover", display: "block", transition: "transform 0.35s ease",
  },
  cardTitle: { fontSize: 15, fontWeight: 900, lineHeight: 1.4 },
  cardMeta: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    color: "#9aa1aa",
    marginTop: 6,
  },
  /** 中身がある曲の印。空の曲より目立たせる */
  cardMetaHas: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    fontWeight: 800,
    color: "#000",
    marginTop: 6,
  },

  /** 中身のある曲への近道（一等地） */
  pickup: { marginTop: 28 },
  pickupH: { fontSize: 13, fontWeight: 900, margin: "0 0 10px", letterSpacing: "0.04em" },
  cardOn: { background: "#000", color: "#fff" },
  cardMetaOn: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    fontWeight: 800,
    color: "#fff",
    opacity: 0.85,
    marginTop: 6,
  },
  notice: { background: "#fff", padding: "16px 18px", fontSize: 14, marginTop: 24 },
  foot: { fontSize: 12, color: "#585f6c", marginTop: 56, lineHeight: 1.8 },

  /** 検索・グループ絞り込み */
  filterBar: { marginTop: 28, display: "flex", flexDirection: "column", gap: 10 },
  searchInput: {
    display: "block", width: "100%", boxSizing: "border-box",
    background: "#fff", color: "#000", border: 0,
    padding: "12px 14px", fontSize: 14, fontFamily: "inherit",
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    background: "#fff", color: "#000", border: 0,
    padding: "7px 12px", fontSize: 12, fontWeight: 800,
    cursor: "pointer", fontFamily: "inherit",
  },
  chipOn: { background: "#000", color: "#fff" },

  /** 動画が2本以上ある曲の選択表示（A）。横長サムネイルを縦に並べる */
  videoPickList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  videoPickItem: { display: "block", textDecoration: "none", color: "inherit" },
  videoPickImg: { display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover", background: "#e5e5e5" },
  videoPickLabel: { fontSize: 12, fontWeight: 800, marginTop: 4 },
};
