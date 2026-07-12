import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// ── service worker: офлайн + автообновление ──
// iPhone держит приложение с экрана «Домой» в памяти и сам новую версию не ищет,
// поэтому проверяем обновления при каждом открытии и перезагружаем страницу,
// как только новая версия установилась.
if ("serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((reg) => {
        const check = () => { if (!document.hidden) reg.update().catch(() => {}); };
        check();
        // приложение вернули из фона (или переключили вкладку) — проверяем снова
        document.addEventListener("visibilitychange", check);
      })
      .catch(() => {});
  });
}
