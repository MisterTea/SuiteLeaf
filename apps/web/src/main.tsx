import { createRoot } from "react-dom/client";
import App from "./App";
import { FontEngineNotice } from "./font-engine-notice";
import "./theme";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <FontEngineNotice />
  </>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD && !window.suiteleaf)
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {});
  });
