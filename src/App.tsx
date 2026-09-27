import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { BrowserRouter, Routes, Route, useLocation, matchRoutes, type Location } from "react-router-dom";
import TeloppOverlay from "./components/TeloppOverlay";
import ErrorBoundary from "./components/ErrorBoundary";
import { WAVE_COLORS, coverScreen, holdUntilReady, iconFontReady, isWaveExcluded, prefersReducedMotion, revealScreen } from "./lib/pageWave";

// ルートごとにコード分割（初期バンドルサイズを削減して LCP を改善）。
// 読み込み関数を表にしておき、ページ移動の演出中に次のページを先に読み込む。
const ROUTES: { path: string; load: () => Promise<{ default: ComponentType }> }[] = [
  { path: "/", load: () => import("./pages/TopPage") },
  { path: "/profile", load: () => import("./pages/profile/ProfilePage") },
  { path: "/p/:slug", load: () => import("./pages/profile/SlugPage") },
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

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

// ページの中身が実際に画面に描かれたら知らせる（読み込み待ちの間は描かれないので呼ばれない）
function MountSignal({ onMount }: { onMount: () => void }) {
  useLayoutEffect(() => { onMount(); });
  return null;
}

// ページ移動の演出（全ページ共通・1箇所）。
// 通常は図形の波で画面を覆い、次のページとアイコンの準備ができてから引く（src/lib/pageWave.ts）。
// 独自の演出を持つページへの出入りと、動きを減らす設定のときは、従来の軽いフェードインにする。
function AnimatedRoutes() {
  const location = useLocation();
  const [shown, setShown] = useState<Location>(location);
  const [fade, setFade] = useState(true);
  const layerRef = useRef<HTMLDivElement>(null);
  const latest = useRef(location);
  latest.current = location;
  const shownRef = useRef(location);
  shownRef.current = shown;
  const busy = useRef(false);
  const started = useRef(false);
  const [firstCover] = useState(() => !prefersReducedMotion() && !isWaveExcluded(location.pathname));
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

  const go = (target: Location) => {
    const from = shownRef.current.pathname;
    const layer = layerRef.current;
    if (target.pathname === from) { setShown(target); return; }
    if (!layer || prefersReducedMotion() || isWaveExcluded(from) || isWaveExcluded(target.pathname)) {
      setFade(true);
      setShown(target);
      return;
    }
    busy.current = true;
    void (async () => {
      preloadPage(target.pathname);
      const cover = await coverScreen(layer);
      const dest = latest.current;
      setFade(false);
      setShown(dest);
      await holdUntilReady(layer, cover, Promise.all([pageShown(dest.key), iconFontReady()]).then(nextFrames));
      await revealScreen(layer, cover);
      busy.current = false;
      if (latest.current !== dest) go(latest.current);
    })();
  };

  // サイトを開いた最初の1回：覆った状態から始め、準備ができたら引く
  useEffect(() => {
    if (!firstCover || started.current || !layerRef.current) return;
    started.current = true;
    const layer = layerRef.current;
    busy.current = true;
    void (async () => {
      const cover = await coverScreen(layer, true);
      setStaticCover(false);
      setFade(false);
      await holdUntilReady(layer, cover, Promise.all([pageShown(location.key), iconFontReady()]).then(nextFrames));
      await revealScreen(layer, cover);
      busy.current = false;
      if (latest.current !== shownRef.current) go(latest.current);
    })();
  }, []);

  useEffect(() => {
    if (!busy.current && location !== shownRef.current) go(location);
  }, [location]);

  return (
    <>
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
      <div
        ref={layerRef}
        className="page-wave"
        aria-hidden="true"
        style={staticCover ? { background: WAVE_COLORS[0], pointerEvents: "auto" } : undefined}
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
