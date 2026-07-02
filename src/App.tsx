import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import TeloppOverlay from "./components/TeloppOverlay";
import ErrorBoundary from "./components/ErrorBoundary";

// ルートごとにコード分割（初期バンドルサイズを削減して LCP を改善）
const TopPage         = lazy(() => import("./pages/TopPage"));
const ProfilePage     = lazy(() => import("./pages/profile/ProfilePage"));
const SlugPage        = lazy(() => import("./pages/profile/SlugPage"));
const FcTicketPage    = lazy(() => import("./pages/fc-ticket/FcTicketPage"));
const YouTubePage     = lazy(() => import("./pages/youtube/YouTubePage"));
const YouTubePickupPage = lazy(() => import("./pages/youtube/YouTubePickupPage"));
const TheBalladPage   = lazy(() => import("./pages/the-ballad/TheBalladPage"));
const HiTensionPage   = lazy(() => import("./pages/hi-tension/HiTensionPage"));
const HiTensionAuthorPage = lazy(() => import("./pages/hi-tension/HiTensionAuthorPage"));
const HiTensionPracticePage = lazy(() => import("./pages/hi-tension/HiTensionPracticePage"));
const ArigatoBeatTapPage = lazy(() => import("./pages/hi-tension/ArigatoBeatTapPage"));
const ArigatoBeatCallPage = lazy(() => import("./pages/hi-tension/ArigatoBeatCallPage"));
const ArigatoBeatQuizPage = lazy(() => import("./pages/hi-tension/ArigatoBeatQuizPage"));
const PrivacyPage     = lazy(() => import("./pages/PrivacyPage"));
const TermsPage       = lazy(() => import("./pages/TermsPage"));
const NotFoundPage    = lazy(() => import("./pages/NotFoundPage"));

// ルート変更ごとにページ全体を軽くフェードインさせる（全ページ共通・1箇所）。
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-fade-in">
      <Routes location={location}>
        <Route path="/" element={<TopPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/p/:slug" element={<SlugPage />} />
        <Route path="/fc-ticket" element={<FcTicketPage />} />
        <Route path="/youtube" element={<YouTubePage />} />
        <Route path="/youtube/pickup" element={<YouTubePickupPage />} />
        <Route path="/the-ballad" element={<TheBalladPage />} />
        <Route path="/hi-tension" element={<HiTensionPage />} />
        <Route path="/hi-tension/author" element={<HiTensionAuthorPage />} />
        <Route path="/hi-tension/practice" element={<HiTensionPracticePage />} />
        <Route path="/arigato-beat/beat" element={<ArigatoBeatTapPage />} />
        <Route path="/arigato-beat/call" element={<ArigatoBeatCallPage />} />
        <Route path="/arigato-beat" element={<ArigatoBeatQuizPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
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
