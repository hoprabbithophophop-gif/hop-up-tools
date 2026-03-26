import { BrowserRouter, Routes, Route } from "react-router-dom";
import TopPage from "./pages/TopPage";
import ProfilePage from "./pages/profile/ProfilePage";
import SlugPage from "./pages/profile/SlugPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TopPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/p/:slug" element={<SlugPage />} />
      </Routes>
    </BrowserRouter>
  );
}
