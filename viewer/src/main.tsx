import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./shared/theme";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}
initTheme();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
