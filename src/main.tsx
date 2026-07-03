import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import "./utils/demoRecorderGlobal";

// ?debug=1 でオンデバイスのデバッグコンソール(eruda)を起動。iPhone等で画面上にログを表示できる。
// 一度付けると localStorage に記憶し、画面内遷移でクエリが消えても継続する（?debug=0 で解除）。
{
  const dbg = new URLSearchParams(location.search).get("debug");
  if (dbg === "0") localStorage.removeItem("tb_debug");
  if (dbg === "1" || localStorage.getItem("tb_debug") === "1") {
    localStorage.setItem("tb_debug", "1");
    import("eruda").then((m) => m.default.init()).catch(() => {});
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
