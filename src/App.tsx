import { BrowserRouter, Routes, Route } from "react-router-dom";
import TopPage from "./pages/TopPage";
import ProfilePage from "./pages/profile/ProfilePage";
import SlugPage from "./pages/profile/SlugPage";
import FcTicketPage from "./pages/fc-ticket/FcTicketPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import YouTubePage from "./pages/youtube/YouTubePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TopPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/p/:slug" element={<SlugPage />} />
        <Route path="/fc-ticket" element={<FcTicketPage />} />
        <Route path="/youtube" element={<YouTubePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
