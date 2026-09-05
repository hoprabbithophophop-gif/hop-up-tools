import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** ツアー本体（concertsテーブルの1行） */
type Concert = {
  concert_key: string;
  name: string;
  group_name: string | null;
  period_start: string | null;
  period_end: string | null;
  shows: number | null;
  source_url: string | null;
  display_order: number | null;
  note: string | null;
};

/** ツアーのセトリ1行（concert_songsテーブルの1行） */
type ConcertSong = {
  concert_key: string;
  seq: number;
  kind: string;
  title: string;
  performer: string | null;
  song_id: string | null;
  show_date: string | null;
  show_venue: string | null;
};

/** サムネイル切り替え間隔（秒）の既定値。?thumb=<秒> で上書きできる仕掛けは残す（UIには出さない） */
const DEFAULT_THUMB_INTERVAL_SEC = 5;

function thumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * カード左のサムネイル（16:9）。動画が切り替わったら、新しい画像を横から入れて
 * 古い画像を反対側へ抜く横スライドで入れ替える。direction="right"（既定）は新が右から
 * （通常表示の自動切替、選択表示の▶）、"left"は新が左から（選択表示の◀）。
 * 動画が1本しかない曲はそもそも呼ばれない側で弾く。
 */
function Thumb({ videoId, direction = "right" }: { videoId: string; direction?: "left" | "right" }) {
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

  // 右から新が来る場合: 旧は0→-100%、新は100%→0。左から新が来る場合はその逆
  const prevTo = direction === "left" ? "translateX(100%)" : "translateX(-100%)";
  const curFrom = direction === "left" ? "translateX(-100%)" : "translateX(100%)";

  return (
    <>
      <img
        src={thumbUrl(pair.prev)}
        alt=""
        style={{ ...S.thumbImgSlide, transform: animating ? prevTo : "translateX(0)" }}
      />
      <img
        src={thumbUrl(pair.current)}
        alt=""
        style={{ ...S.thumbImgSlide, transform: animating ? "translateX(0)" : curFrom }}
      />
    </>
  );
}

/**
 * 「ツアーから探す」で開いた段の中身。動画のある曲だけをseq順に並べ、
 * カード列を2周ぶん描いて半周でtranslateXを折り返す＝輪にして行き止まりをなくす。
 * ポインタのドラッグと右端の◀▶（1回で1カードぶん158px）でめくれる。
 * 開いている間は右から左へ25px/秒で流れ続け、触ったか矢印を押したら止めて以後は再開しない。
 */
function TourRow({
  items,
  onOpenModal,
}: {
  items: { seq: number; song: Song }[];
  onOpenModal: (song: Song, el: HTMLElement) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const xRef = useRef(0);
  const dragRef = useRef<{ sx: number; x0: number; moved: number } | null>(null);
  /** 開いた直後の自動で流れる演出を続けてよいか。触る／矢印を押すとfalseにして止め、再開はしない */
  const driftRef = useRef(true);
  /** ドラッグで8px以上動いた直後の1回だけ、続くクリックを無効にする */
  const suppressClickRef = useRef(false);

  const apply = () => {
    const track = trackRef.current;
    if (!track) return;
    const half = track.scrollWidth / 2;
    if (half > 0) xRef.current = ((xRef.current % half) + half) % half;
    track.style.transform = `translateX(${-xRef.current}px)`;
  };

  const step = (n: number) => {
    driftRef.current = false;
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "transform .3s ease";
    xRef.current += n * 158;
    apply();
    setTimeout(() => { if (track) track.style.transition = ""; }, 320);
  };

  useEffect(() => {
    apply();
    const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      if (!driftRef.current) return;
      xRef.current += dt * 0.025;
      apply();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    driftRef.current = false;
    dragRef.current = { sx: e.clientX, x0: xRef.current, moved: 0 };
    (e.target as Element).setPointerCapture(e.pointerId);
    if (trackRef.current) trackRef.current.style.transition = "";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    d.moved = Math.max(d.moved, Math.abs(dx));
    xRef.current = d.x0 - dx;
    apply();
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (d && d.moved >= 8) suppressClickRef.current = true;
    dragRef.current = null;
  };

  /** ドラッグ直後のクリックなら握りつぶす。trueを返したときは呼び出し側も何もしない */
  const guardClick = (e: React.MouseEvent): boolean => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      return true;
    }
    return false;
  };

  const renderCard = (item: { seq: number; song: Song }, dupKey: string) => {
    const videoId = item.song.videos[0]?.video_id;
    const body = (
      <>
        <div style={S.scThumb} data-thumb-anchor="true">
          {videoId && <img src={thumbUrl(videoId)} alt="" style={S.scThumbImg} />}
        </div>
        <div style={S.scTitle}>{item.song.title}</div>
      </>
    );
    if (item.song.videos.length < 2) {
      return (
        <Link
          key={dupKey}
          to={`/call-center/song/${item.song.slug}/place`}
          style={S.scCard}
          onClick={(e) => { guardClick(e); }}
        >
          {body}
        </Link>
      );
    }
    const activate = (e: React.SyntheticEvent) => { onOpenModal(item.song, e.currentTarget as HTMLElement); };
    return (
      <div
        key={dupKey}
        role="button"
        tabIndex={0}
        style={S.scCard}
        onClick={(e) => { if (guardClick(e)) return; activate(e); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") activate(e); }}
      >
        {body}
      </div>
    );
  };

  return (
    <div style={S.tourOpen}>
      <div style={S.tourArrows}>
        <button type="button" style={S.arrowBtn} onClick={() => step(-1)} aria-label="前へ">◀</button>
        <button type="button" style={S.arrowBtn} onClick={() => step(1)} aria-label="次へ">▶</button>
      </div>
      <div
        style={S.tourRowWrap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(e) => e.preventDefault()}
      >
        <div ref={trackRef} style={S.tourTrack}>
          {items.map((it) => renderCard(it, `${it.seq}-a`))}
          {items.map((it) => renderCard(it, `${it.seq}-b`))}
        </div>
      </div>
    </div>
  );
}

/**
 * 「ツアーから探す」の1段の開閉。開くときは高さ0→中身の高さへ0.3秒で伸ばし、
 * 閉じるときは逆に縮めてから外す（外し終わったらonExitedで親に伝える）。
 * 同時にカード列（中身全体）を右へ24pxずれた透明な状態から定位置・不透明へ0.3秒で寄せる。
 * このtransform/opacityは段のラッパーに掛けており、TourRow内部の輪のtranslateXとは別要素。
 */
function TourRowShell({
  open,
  onExited,
  children,
}: {
  open: boolean;
  onExited: () => void;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef<boolean | null>(null);
  const [entered, setEntered] = useState(false);
  const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // 再レンダーのたびに作り直されるonExitedをそのままeffectの依存に入れると、
  // 遷移の途中でリスナーが張り直されてtransitionendを取り逃がすので、refで最新版だけ持つ
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const prevOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (reduceMotion) {
      outer.style.transition = "";
      outer.style.height = "auto";
      outer.style.overflow = "visible";
      setEntered(open);
      if (!open) onExitedRef.current();
      return;
    }

    if (open && !prevOpen) {
      // 開く: 0 → 中身の高さ
      outer.style.transition = "";
      outer.style.overflow = "hidden";
      outer.style.height = "0px";
      setEntered(false);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        const h = inner.scrollHeight;
        raf2 = requestAnimationFrame(() => {
          outer.style.transition = "height 0.3s ease";
          outer.style.height = `${h}px`;
          setEntered(true);
        });
      });
      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName !== "height") return;
        outer.style.transition = "";
        outer.style.height = "auto";
        outer.style.overflow = "visible";
      };
      outer.addEventListener("transitionend", onEnd);
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        outer.removeEventListener("transitionend", onEnd);
      };
    }

    if (!open && prevOpen) {
      // 閉じる: 中身の高さ → 0、終わったら外す
      const h = inner.scrollHeight;
      outer.style.transition = "";
      outer.style.overflow = "hidden";
      outer.style.height = `${h}px`;
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          outer.style.transition = "height 0.3s ease";
          outer.style.height = "0px";
        });
      });
      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName !== "height") return;
        onExitedRef.current();
      };
      outer.addEventListener("transitionend", onEnd);
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        outer.removeEventListener("transitionend", onEnd);
      };
    }
  }, [open, reduceMotion]);

  return (
    <div ref={outerRef} style={{ overflow: "hidden" }}>
      <div ref={innerRef}>
        <div
          style={{
            transition: reduceMotion ? undefined : "transform 0.3s ease, opacity 0.3s ease",
            transform: entered ? "translateX(0)" : "translateX(24px)",
            opacity: entered ? 1 : 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function CallCenterPage() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 曲ごとに、棚に入っているコールの数 */
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** ツアー本体（display_order順）。読み込めなければ空のまま＝「ツアーから探す」段ごと出さない */
  const [concerts, setConcerts] = useState<Concert[]>([]);
  /** concert_key → そのツアーのセトリ（seq順） */
  const [concertSongsByKey, setConcertSongsByKey] = useState<Record<string, ConcertSong[]>>({});
  /** 開いているツアーのconcert_key。null＝どれも開いていない（1段だけ開く） */
  const [openConcert, setOpenConcert] = useState<string | null>(null);
  /** 閉じるアニメーション中のconcert_key（閉じ終わるまでDOMに残す）。開閉アニメーションのため */
  const [closingConcerts, setClosingConcerts] = useState<Record<string, true>>({});
  /** 曲名の検索欄。空なら絞り込まない */
  const [query, setQuery] = useState("");
  /** グループの絞り込み。null＝全て */
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  /** 動画が2本以上ある曲のカードをタップして開いた、画面全体の動画選びモーダル。null＝閉じている */
  const [modalSong, setModalSong] = useState<Song | null>(null);
  /** モーダルでいま出している動画のインデックス */
  const [modalIdx, setModalIdx] = useState(0);
  /** モーダルのサムネ切り替え方向。◀→"left"、▶→"right" */
  const [modalDir, setModalDir] = useState<"left" | "right">("right");
  /** 開いた瞬間にタップされたカードのサムネ矩形（拡大アニメーションの起点） */
  const [modalOrigin, setModalOrigin] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  /** 閉じるアニメーション中（この間は二重タップ・多重オープンを無視） */
  const [modalClosing, setModalClosing] = useState(false);
  const modalCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalBoxRef = useRef<HTMLDivElement>(null);
  const modalOverlayRef = useRef<HTMLDivElement>(null);
  const modalTitleRef = useRef<HTMLDivElement>(null);
  const modalArrowLeftWrapRef = useRef<HTMLDivElement>(null);
  const modalArrowRightWrapRef = useRef<HTMLDivElement>(null);
  const modalLabelRef = useRef<HTMLDivElement>(null);
  const modalButtonsWrapRef = useRef<HTMLDivElement>(null);
  /** 開くときに発火したWeb Animations APIのアニメーション一式（閉じるときに逆再生する） */
  const modalAnimsRef = useRef<Animation[]>([]);
  const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /** カードのサムネ枠（[data-thumb-anchor]）の画面上の位置から、画面中央へ拡大しながらモーダルを開く */
  const openModal = (song: Song, cardEl: HTMLElement) => {
    if (modalClosing) return;
    const anchor = (cardEl.querySelector("[data-thumb-anchor]") as HTMLElement | null) ?? cardEl;
    const rect = anchor.getBoundingClientRect();
    setModalOrigin({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    setModalIdx(tick % song.videos.length);
    setModalDir("right");
    setModalSong(song);
    document.body.style.overflow = "hidden";
  };

  /** アニメーションを待たず即座に閉じ切る（WAA非対応時のフォールバック用） */
  const finishCloseImmediately = (delayMs: number) => {
    if (modalCloseTimerRef.current) clearTimeout(modalCloseTimerRef.current);
    modalCloseTimerRef.current = setTimeout(() => {
      setModalSong(null);
      setModalOrigin(null);
      setModalClosing(false);
    }, delayMs);
  };

  /** 起点矩形へ縮みながら閉じる（開いたときのアニメーションを逆再生）。閉じ切ったらDOMから外す */
  const closeModal = () => {
    setModalClosing((closing) => {
      if (closing) return closing;
      document.body.style.overflow = "";
      const anims = modalAnimsRef.current;
      const duration = reduceMotion ? 0 : 300;
      if (anims.length > 0 && typeof anims[0].reverse === "function") {
        try {
          anims.forEach((a) => a.reverse());
          Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
            setModalSong(null);
            setModalOrigin(null);
            setModalClosing(false);
            modalAnimsRef.current = [];
          });
        } catch {
          finishCloseImmediately(duration);
        }
      } else {
        finishCloseImmediately(duration);
      }
      return true;
    });
  };

  // 開いたサムネ要素の実際の最終矩形を測って、起点矩形との差から開始transformを作り、
  // Web Animations APIで「起点矩形→中央」の拡大と、幕・矢印行・ラベルのフェードを走らせる。
  useLayoutEffect(() => {
    if (!modalSong || !modalOrigin) return;
    const box = modalBoxRef.current;
    const overlay = modalOverlayRef.current;
    if (!box || !overlay) return;

    modalAnimsRef.current.forEach((a) => a.cancel());
    modalAnimsRef.current = [];

    const finalRect = box.getBoundingClientRect();
    const dx = modalOrigin.left - finalRect.left;
    const dy = modalOrigin.top - finalRect.top;
    const sx = modalOrigin.width / finalRect.width;
    const sy = modalOrigin.height / finalRect.height;
    const duration = reduceMotion ? 0 : 300;

    try {
      const boxAnim = box.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
        { duration, easing: "ease", fill: "both" },
      );
      const overlayAnim = overlay.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration, easing: "ease", fill: "both" },
      );
      const anims = [boxAnim, overlayAnim];
      const textDuration = reduceMotion ? 0 : 150;
      const textDelay = reduceMotion ? 0 : 150;
      for (const el of [
        modalTitleRef.current,
        modalArrowLeftWrapRef.current,
        modalArrowRightWrapRef.current,
        modalLabelRef.current,
        modalButtonsWrapRef.current,
      ]) {
        if (!el) continue;
        anims.push(
          el.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: textDuration, delay: textDelay, easing: "ease", fill: "both" },
          ),
        );
      }
      modalAnimsRef.current = anims;
    } catch {
      // Web Animations API 非対応。アニメーションなしで即座に開いた状態にする
      box.style.transform = "none";
      overlay.style.opacity = "1";
      if (modalTitleRef.current) modalTitleRef.current.style.opacity = "1";
      if (modalArrowLeftWrapRef.current) modalArrowLeftWrapRef.current.style.opacity = "1";
      if (modalArrowRightWrapRef.current) modalArrowRightWrapRef.current.style.opacity = "1";
      if (modalLabelRef.current) modalLabelRef.current.style.opacity = "1";
      if (modalButtonsWrapRef.current) modalButtonsWrapRef.current.style.opacity = "1";
    }
  }, [modalSong, modalOrigin]);

  // 開いている間はEscで閉じる
  useEffect(() => {
    if (!modalSong) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalSong]);

  // アンマウント時の後片付け（開いたままページを離れた場合に備える）
  useEffect(() => () => {
    if (modalCloseTimerRef.current) clearTimeout(modalCloseTimerRef.current);
    modalAnimsRef.current.forEach((a) => a.cancel());
    document.body.style.overflow = "";
  }, []);

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

  useEffect(() => {
    // ここで失敗しても曲一覧自体には触らない。「ツアーから探す」段が出ないだけにする
    try {
      getSupabase()
        .from("concerts")
        .select("concert_key, name, group_name, period_start, period_end, shows, source_url, display_order, note")
        .order("display_order", { ascending: true })
        .then(({ data, error }) => {
          if (error || !data) return;
          setConcerts(data as Concert[]);
        });

      getSupabase()
        .from("concert_songs")
        .select("concert_key, seq, kind, title, performer, song_id, show_date, show_venue")
        .order("concert_key", { ascending: true })
        .order("seq", { ascending: true })
        .then(({ data, error }) => {
          if (error || !data) return;
          const m: Record<string, ConcertSong[]> = {};
          for (const row of data as ConcertSong[]) {
            const list = m[row.concert_key] ?? [];
            list.push(row);
            m[row.concert_key] = list;
          }
          setConcertSongsByKey(m);
        });
    } catch {
      // 何もしない。段は出ないままになる
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

  // concert_songs.song_id → song_structures.id なので、棚から読んだ曲（built-inは対象外）だけで引く
  const songById = new Map<string, Song>();
  for (const s of songs ?? []) songById.set(s.id, s);

  /** そのツアーで、動画が結び付いている曲だけをseq順に */
  const playableSongs = (key: string): { seq: number; song: Song }[] => {
    const out: { seq: number; song: Song }[] = [];
    for (const row of concertSongsByKey[key] ?? []) {
      if (!row.song_id) continue;
      const song = songById.get(row.song_id);
      if (!song || song.videos.length === 0) continue;
      out.push({ seq: row.seq, song });
    }
    return out;
  };

  /**
   * ツアーのタイトルボタンを押したときの開閉。同じツアーを閉じるときも、別のツアーへ
   * 切り替えるときも、それまで開いていたキーは即座にDOMから外さず「閉じるアニメーション中」
   * に回してから、TourRowShellのonExitedで外す
   */
  const toggleConcert = (key: string) => {
    if (openConcert && openConcert !== key) {
      setClosingConcerts((s) => ({ ...s, [openConcert]: true }));
    }
    setOpenConcert((prev) => {
      const next = prev === key ? null : key;
      if (prev === key) setClosingConcerts((s) => ({ ...s, [key]: true }));
      return next;
    });
  };

  /** カード本文（左サムネイル＋右の曲名・メタ行）の中身だけを組み立てる */
  const renderCardBody = (song: Song, metaText: string, metaStyle: React.CSSProperties) => (
    <div style={S.cardRow}>
      {song.videos.length > 0 && (
        <div style={S.thumbWrap} data-thumb-anchor="true">
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

    // 動画が2本以上ある曲: タップで画面全体のモーダルを開く（カードの高さ自体は変わらない）
    return (
      <div
        key={song.id}
        role="button"
        tabIndex={0}
        style={cardStyle}
        onClick={(e) => openModal(song, e.currentTarget)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openModal(song, e.currentTarget); }}
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

        {/* ツアーから探す。検索・グループ絞り込み中は出さない（曲が直接出るので）。
            タイトルだけ並べ、押すとそのツアーのセトリが横スクロールで開く（1段だけ） */}
        {!isFiltering && concerts.length > 0 && (
          <section style={S.section}>
            <h2 style={S.h2}>ツアーから探す</h2>
            <div>
              {concerts.map((c) => {
                const rowItems = playableSongs(c.concert_key);
                const isOpen = openConcert === c.concert_key;
                const isClosing = !!closingConcerts[c.concert_key];
                return (
                  <div key={c.concert_key} style={S.tourBlock}>
                    <button
                      type="button"
                      style={S.tourTitleBtn}
                      onClick={() => toggleConcert(c.concert_key)}
                    >
                      {c.group_name && <div style={S.tourGroup}>{c.group_name}</div>}
                      <div style={S.tourName}>{c.name}</div>
                      <div style={S.tourMeta}>動画あり {rowItems.length}曲</div>
                    </button>
                    {(isOpen || isClosing) && rowItems.length > 0 && (
                      <TourRowShell
                        open={isOpen}
                        onExited={() => setClosingConcerts((s) => {
                          if (!s[c.concert_key]) return s;
                          const n = { ...s };
                          delete n[c.concert_key];
                          return n;
                        })}
                      >
                        <TourRow items={rowItems} onOpenModal={openModal} />
                      </TourRowShell>
                    )}
                  </div>
                );
              })}
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

      {/* 動画えらびモーダル。動画が2本以上ある曲のカードをタップすると画面全体を覆って開く */}
      {modalSong && (() => {
        const idx = Math.min(modalIdx, modalSong.videos.length - 1);
        const v = modalSong.videos[idx];
        const atStart = idx <= 0;
        const atEnd = idx >= modalSong.videos.length - 1;
        return (
          <div
            ref={modalOverlayRef}
            role="button"
            aria-label="閉じる"
            style={S.modalOverlay}
            onClick={closeModal}
          >
            <div style={S.modalWindow} onClick={(e) => e.stopPropagation()}>
              <div ref={modalTitleRef} style={S.modalTitle}>{modalSong.title}</div>
              <div style={S.modalRow}>
                <div ref={modalArrowLeftWrapRef} style={S.modalArrowWrap}>
                  <button
                    type="button"
                    style={{ ...S.arrowBtn, opacity: atStart ? 0.3 : 1, cursor: atStart ? "default" : "pointer" }}
                    disabled={atStart}
                    onClick={() => { if (!atStart) { setModalDir("left"); setModalIdx(idx - 1); } }}
                    aria-label="前の動画"
                  >◀</button>
                </div>
                <div
                  ref={modalBoxRef}
                  style={{
                    ...S.modalThumbBox,
                    transformOrigin: "top left",
                  }}
                >
                  <Thumb videoId={v.video_id} direction={modalDir} />
                </div>
                <div ref={modalArrowRightWrapRef} style={S.modalArrowWrap}>
                  <button
                    type="button"
                    style={{ ...S.arrowBtn, opacity: atEnd ? 0.3 : 1, cursor: atEnd ? "default" : "pointer" }}
                    disabled={atEnd}
                    onClick={() => { if (!atEnd) { setModalDir("right"); setModalIdx(idx + 1); } }}
                    aria-label="次の動画"
                  >▶</button>
                </div>
              </div>
              {v.label && (
                <div ref={modalLabelRef} style={S.videoPickLabel}>
                  {v.label}
                </div>
              )}
              <div ref={modalButtonsWrapRef}>
                <Link to={`/call-center/song/${modalSong.slug}/place?v=${v.video_id}`} style={S.modalRegisterBtn}>
                  この動画にコールを登録
                </Link>
                <button type="button" style={S.modalCloseBtn} onClick={closeModal}>閉じる</button>
              </div>
            </div>
          </div>
        );
      })()}
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
  // サムネイル（16:9）。動画が無い曲は今までどおり画像を出さない
  thumbWrap: {
    width: 96, height: 54, flexShrink: 0, overflow: "hidden", background: "#e5e5e5",
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

  /** ツアーから探す */
  tourBlock: { marginBottom: 2 },
  tourTitleBtn: {
    display: "block", width: "100%", boxSizing: "border-box", textAlign: "left",
    background: "#fff", color: "inherit", border: 0,
    padding: "14px 18px", cursor: "pointer", fontFamily: "inherit",
  },
  tourGroup: { fontSize: 11, fontWeight: 800, color: "#9aa1aa" },
  tourName: { fontSize: 15, fontWeight: 900, marginTop: 2, lineHeight: 1.3 },
  tourMeta: { fontSize: 11, color: "#9aa1aa", marginTop: 4 },
  tourOpen: { marginTop: 2, marginBottom: 6 },
  tourArrows: { display: "flex", justifyContent: "flex-end", gap: 6, padding: "0 18px 6px" },
  tourRowWrap: { position: "relative", overflow: "hidden", touchAction: "pan-y", cursor: "grab" },
  tourTrack: { display: "flex", gap: 8, padding: "0 18px", willChange: "transform" },
  scCard: {
    display: "block", flex: "0 0 150px", background: "#fff", padding: 8,
    boxSizing: "border-box", userSelect: "none", textDecoration: "none",
    color: "inherit", cursor: "pointer",
  },
  scThumb: { width: "100%", aspectRatio: "16 / 9", background: "#e5e5e5", overflow: "hidden" },
  scThumbImg: { width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" },
  scTitle: { fontSize: 12, fontWeight: 900, lineHeight: 1.3, marginTop: 6, height: 31, overflow: "hidden" },
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

  /** 動画えらびモーダル。画面全体を覆う幕 */
  modalOverlay: {
    position: "fixed", inset: 0, zIndex: 150,
    background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  // 白い小窓本体
  modalWindow: { background: "#fff", padding: 14, width: "min(92vw, 300px)", boxSizing: "border-box", cursor: "default" },
  modalTitle: { fontSize: 15, fontWeight: 900, margin: "0 0 10px" },
  modalRow: { display: "flex", alignItems: "center", gap: 8 },
  modalArrowWrap: { flex: "0 0 auto" },
  modalThumbBox: { flex: "1 1 auto", aspectRatio: "16 / 9", background: "#e5e5e5", position: "relative", overflow: "hidden" },
  // PlacePageの色切り替え矢印と同じ見た目
  arrowBtn: { flex: "0 0 auto", width: 26, height: 26, background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 },
  videoPickLabel: { fontSize: 12, fontWeight: 800, marginTop: 8 },
  modalRegisterBtn: {
    display: "block", width: "100%", boxSizing: "border-box", textAlign: "center", textDecoration: "none",
    background: "#000", color: "#fff", border: 0, padding: "12px 14px", fontSize: 14, fontWeight: 800,
    marginTop: 12, cursor: "pointer", fontFamily: "inherit",
  },
  modalCloseBtn: {
    display: "block", width: "100%", boxSizing: "border-box",
    background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #ccc",
    padding: 10, fontSize: 13, fontWeight: 700, marginTop: 8, cursor: "pointer", fontFamily: "inherit",
  },
};
