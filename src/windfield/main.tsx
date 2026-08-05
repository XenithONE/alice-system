/*
 * WIND FIELD — a walkable grassland, on its own entry point.
 *
 * Shares src/gpu/ with the gallery: the probe, the mount with its three
 * guarded awaits, the frame clock and the deep dispose are all the same code.
 * Nothing under src/portfolio/** imports from here, which is the rule that
 * keeps index.html's 95,000 gzip budget unable to notice this page exists.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WindFieldPage } from "./WindFieldPage";
import { watchOsPreference } from "../portfolio/motion";
import "../portfolio/portfolio.css";
import "../portfolio/theme.css";
import "./windfield.css";

watchOsPreference();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WindFieldPage />
  </StrictMode>
);
