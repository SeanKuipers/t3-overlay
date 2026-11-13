import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Overlay } from "./components/Overlay";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>{view === "settings" ? <Settings /> : <Overlay />}</StrictMode>,
);
