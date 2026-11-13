import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Overlay } from "./components/Overlay";
import { native } from "./lib/native";
import { Settings } from "./components/Settings";
import "./styles.css";

const params = new URLSearchParams(location.search);
const mock = import.meta.env.DEV ? params.get("mock") : null;
const view = mock === "settings" ? "settings" : params.get("view") ?? "overlay";
document.documentElement.dataset.view = view;
if (mock) {
  document.documentElement.dataset.mock = "";
  await (await import("./dev/mock")).installMock(mock);
}

if (view === "overlay" && !mock) {
  // Anything that goes wrong in the (invisible-when-broken) overlay page shows up in
  // Settings → Diagnostics.
  const report = (message: string) => native.overlayReport("error", message).catch(() => {});
  window.addEventListener("error", (e) => report(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) =>
    report(`Unhandled: ${e.reason instanceof Error ? e.reason.message : JSON.stringify(e.reason)}`),
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {view === "settings" ? (
      <Settings />
    ) : (
      <ErrorBoundary>
        <Overlay />
      </ErrorBoundary>
    )}
  </StrictMode>,
);
