import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import "./utils/demoRecorderGlobal";
import { reportIncidentThrottled } from "./utils/debugLog";

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

// ドライブレコーダー式: 未捕捉エラーを異常として前後ログ付きで記録（localStorage tb_incidents）
window.addEventListener("error", (e) =>
  reportIncidentThrottled("jserror", { msg: String(e.message), src: e.filename, line: e.lineno })
);
window.addEventListener("unhandledrejection", (e) =>
  reportIncidentThrottled("unhandledrejection", { reason: String((e as PromiseRejectionEvent).reason).slice(0, 300) })
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
