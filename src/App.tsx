import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import TeloppOverlay from "./components/TeloppOverlay";
import ErrorBoundary from "./components/ErrorBoundary";

// ルートごとにコード分割（初期バンドルサイズを削減して LCP を改善）
const TopPage         = lazy(() => import("./pages/TopPage"));
const ProfilePage     = lazy(() => import("./pages/profile/ProfilePage"));
const SlugPage        = lazy(() => import("./pages/profile/SlugPage"));
const FcTicketPage    = lazy(() => import("./pages/fc-ticket/FcTicketPage"));
const YouTubePage     = lazy(() => import("./pages/youtube/YouTubePage"));
const YouTubePickupPage = lazy(() => import("./pages/youtube/YouTubePickupPage"));
const HiTensionPage   = lazy(() => import("./pages/hi-tension/HiTensionPage"));
const HiTensionAuthorPage = lazy(() => import("./pages/hi-tension/HiTensionAuthorPage"));
const HiTensionPracticePage = lazy(() => import("./pages/hi-tension/HiTensionPracticePage"));
const HiTensionBeatTapPage = lazy(() => import("./pages/hi-tension/HiTensionBeatTapPage"));
const HiTensionCallPage = lazy(() => import("./pages/hi-tension/HiTensionCallPage"));
const HiTensionMicTestPage = lazy(() => import("./pages/hi-tension/HiTensionMicTestPage"));
const PrivacyPage     = lazy(() => import("./pages/PrivacyPage"));
const TermsPage       = lazy(() => import("./pages/TermsPage"));
const NotFoundPage    = lazy(() => import("./pages/NotFoundPage"));

export default function App() {
  return (
    <BrowserRouter>
      <TeloppOverlay />
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<TopPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/p/:slug" element={<SlugPage />} />
            <Route path="/fc-ticket" element={<FcTicketPage />} />
            <Route path="/youtube" element={<YouTubePage />} />
            <Route path="/youtube/pickup" element={<YouTubePickupPage />} />
            <Route path="/hi-tension" element={<HiTensionPage />} />
            <Route path="/hi-tension/author" element={<HiTensionAuthorPage />} />
            <Route path="/hi-tension/practice" element={<HiTensionPracticePage />} />
            <Route path="/hi-tension/beat" element={<HiTensionBeatTapPage />} />
            <Route path="/hi-tension/call" element={<HiTensionCallPage />} />
            <Route path="/hi-tension/mic" element={<HiTensionMicTestPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
