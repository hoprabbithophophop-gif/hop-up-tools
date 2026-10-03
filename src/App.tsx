import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { BrowserRouter, Routes, Route, useLocation, useNavigationType, matchRoutes, type Location } from "react-router-dom";
import TeloppOverlay from "./components/TeloppOverlay";
import { pageDataReady } from "./lib/pageReady";
import ErrorBoundary from "./components/ErrorBoundary";
import { WAVE_COLOR, coverScreen, guardPlayers, hasEmbeddedPlayer, holdUntilReady, iconFontReady, isWaveExcluded, prefersReducedMotion, revealScreen, showAreaAfterWave, supportsWave } from "./lib/pageWave";

// ルートごとにコード分割（初期バンドルサイズを削減して LCP を改善）。
// 読み込み関数を表にしておき、ページ移動の演出中に次のページを先に読み込む。
const ROUTES: { path: string; load: () => Promise<{ default: ComponentType }> }[] = [
  { path: "/", load: () => import("./pages/TopPage") },
  { path: "/fc-ticket", load: () => import("./pages/fc-ticket/FcTicketPage") },
  { path: "/youtube", load: () => import("./pages/youtube/YouTubePage") },
  { path: "/youtube/pickup", load: () => import("./pages/youtube/YouTubePickupPage") },
  { path: "/the-ballad", load: () => import("./pages/the-ballad/TheBalladPage") },
  { path: "/hi-tension", load: () => import("./pages/hi-tension/HiTensionPage") },
  { path: "/hai-to-diamond", load: () => import("./pages/hai-to-diamond/HaiToDiamondPage") },
  // シェアのリンクに乗る色と構図の札つきの住所。ページは同じ物を出す（札は看板の絵と入口の最初の色に使う）
  { path: "/hai-to-diamond/:member/:comp", load: () => import("./pages/hai-to-diamond/HaiToDiamondPage") },
  { path: "/hi-tension/author", load: () => import("./pages/hi-tension/HiTensionAuthorPage") },
  { path: "/hi-tension/practice", load: () => import("./pages/hi-tension/HiTensionPracticePage") },
  { path: "/arigato-beat/beat", load: () => import("./pages/hi-tension/ArigatoBeatTapPage") },
  { path: "/arigato-beat/call", load: () => import("./pages/hi-tension/ArigatoBeatCallPage") },
  { path: "/arigato-beat", load: () => import("./pages/hi-tension/ArigatoBeatQuizPage") },
  { path: "/crossword", load: () => import("./pages/crossword/CrosswordPage") },
  { path: "/crossword/list", load: () => import("./pages/crossword/GalleryPage") },
  { path: "/crossword/:id", load: () => import("./pages/crossword/CrosswordPage") },
  { path: "/news", load: () => import("./pages/news/NewsListPage") },
  { path: "/news/:id", load: () => import("./pages/news/NewsArticlePage") },
  { path: "/privacy", load: () => import("./pages/PrivacyPage") },
  { path: "/terms", load: () => import("./pages/TermsPage") },
  { path: "*", load: () => import("./pages/NotFoundPage") },
];
const PAGES = ROUTES.map((r) => ({ ...r, Page: lazy(r.load) }));

function preloadPage(pathname: string): Promise<unknown> {
  const hit = matchRoutes(ROUTES.map((r, i) => ({ path: r.path, id: String(i) })), pathname);
  const route = hit && ROUTES[Number(hit[hit.length - 1].route.id)];
  return route ? route.load() : Promise.resolve();
}

// 波で覆ったまま待つ上限。データが届かない時はここで引いて、ページ自身の読み込み中の表示に任せる【仮】
const DATA_WAIT_CAP_MS = 5000;

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

// ページの中身が実際に画面に描かれたら知らせる（読み込み待ちの間は描かれないので呼ばれない）
function MountSignal({ onMount }: { onMount: () => void }) {
  useLayoutEffect(() => { onMount(); });
  return null;
}

// ページ移動の演出（全ページ共通・1箇所）。
// 通常は図形の波で画面を覆い、次のページとアイコンの準備ができてから引く（src/lib/pageWave.ts）。
// 戻る・進む（スワイプやブラウザのボタン）、独自の演出を持つページへの出入り、動きを減らす設定のときは、
// 従来の軽いフェードインにする（iPhone のスワイプで戻る動きと二重にならないように）。
function AnimatedRoutes() {
  const location = useLocation();
  const navType = useNavigationType();
  const pageAreaRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Location>(location);
  const [fade, setFade] = useState(true);
  const layerRef = useRef<HTMLDivElement>(null);
  const latest = useRef(location);
  latest.current = location;
  const latestType = useRef(navType);
  latestType.current = navType;
  const shownRef = useRef(location);
  shownRef.current = shown;
  const busy = useRef(false);
  const started = useRef(false);
  const [firstCover] = useState(() => supportsWave() && !prefersReducedMotion() && !isWaveExcluded(location.pathname));
  const [staticCover, setStaticCover] = useState(firstCover);
  const mountedKey = useRef<string | null>(null);
  const waiters = useRef(new Map<string, () => void>());
  const onPageMount = () => {
    const key = shownRef.current.key;
    mountedKey.current = key;
    waiters.current.get(key)?.();
    waiters.current.delete(key);
  };
  const pageShown = (key: string) =>
    mountedKey.current === key ? Promise.resolve() : new Promise<void>((r) => waiters.current.set(key, r));

  const go = (target: Location, type: string) => {
    const from = shownRef.current.pathname;
    const layer = layerRef.current;
    const area = pageAreaRef.current;
    if (target.pathname === from) { setShown(target); return; }
    if (!layer || !area || type === "POP" || !supportsWave() || prefersReducedMotion() || isWaveExcluded(from) || isWaveExcluded(target.pathname)) {
      setFade(true);
      setShown(target);
      return;
    }
    busy.current = true;
    void (async () => {
      // 出ていくページに動画プレーヤーがあれば、先に空白にしてから覆う
      const stopGuard = guardPlayers(area);
      preloadPage(target.pathname);
      const cover = await coverScreen(layer);
      const dest = latest.current;
      // 覆っている間に入れ替える。次のページが描かれるまで前のページの長さを保ち（途中でページが
      // 空になって高さが縮むと、スクロール位置とツールバーが動いて画面が上下する）、先頭へ移しておく
      area.style.minHeight = `${document.documentElement.scrollHeight}px`;
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      setFade(false);
      setShown(dest);
      await holdUntilReady(layer, pageShown(dest.key).then(() => Promise.all([iconFontReady(), pageDataReady()])).then(nextFrames), DATA_WAIT_CAP_MS);
      // 前のページが外れたので空白を解く。次のページにプレーヤーがあれば見張りがまた空白にする
      if (!hasEmbeddedPlayer(area)) area.style.visibility = "";
      area.style.minHeight = "";
      await revealScreen(layer, cover);
      stopGuard();
      showAreaAfterWave(area);
      busy.current = false;
      if (latest.current !== dest) go(latest.current, latestType.current);
    })();
  };

  // サイトを開いた最初の1回：覆った状態から始め、準備ができたら引く
  useLayoutEffect(() => {
    if (!firstCover || started.current || !layerRef.current || !pageAreaRef.current) return;
    started.current = true;
    const layer = layerRef.current;
    const area = pageAreaRef.current;
    busy.current = true;
    const stopGuard = guardPlayers(area);
    void (async () => {
      const cover = await coverScreen(layer, true);
      setStaticCover(false);
      setFade(false);
      await holdUntilReady(layer, pageShown(location.key).then(() => Promise.all([iconFontReady(), pageDataReady()])).then(nextFrames), DATA_WAIT_CAP_MS);
      await revealScreen(layer, cover);
      stopGuard();
      showAreaAfterWave(area);
      busy.current = false;
      if (latest.current !== shownRef.current) go(latest.current, latestType.current);
    })();
  }, []);

  useEffect(() => {
    if (!busy.current && location !== shownRef.current) go(location, navType);
  }, [location]);

  return (
    <>
      <div ref={pageAreaRef}>
        <Suspense fallback={null}>
          <div key={shown.pathname} className={fade ? "page-fade-in" : undefined}>
            <Routes location={shown}>
              {PAGES.map(({ path, Page }) => (
                <Route key={path} path={path} element={<Page />} />
              ))}
            </Routes>
          </div>
          <MountSignal onMount={onPageMount} />
        </Suspense>
      </div>
      <div
        ref={layerRef}
        className="page-wave"
        aria-hidden="true"
        style={staticCover ? { background: WAVE_COLOR, pointerEvents: "auto" } : undefined}
      />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TeloppOverlay />
      <ErrorBoundary>
        <Suspense fallback={null}>
          <AnimatedRoutes />
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
