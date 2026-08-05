/*
 * LONG GALLERY — the catalogue, hung on a curve.
 *
 * The corridor is a separate entry point on purpose. index.html carries a
 * 95,000 gzip budget and cannot reach three.js at all; this page reaches
 * three/webgpu, and the two facts cost each other almost nothing because they
 * are different documents in the same multi-page build. The rule that keeps it
 * that way: nothing under src/portfolio/** may ever import from here.
 *
 * "Almost": sharing bento.ts, badges.tsx and motion.ts with the top page makes
 * rolldown split them into their own chunks, and the same bytes in more chunks
 * gzip slightly worse — measured, index.html moved 83,774 -> 84,704 with 384
 * bytes of that raw. No new code reaches the top page; the compression window
 * just got cut into eight pieces instead of five.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GalleryPage } from "./GalleryPage";
import { watchOsPreference } from "../portfolio/motion";
import "../portfolio/portfolio.css";
import "../portfolio/theme.css";
import "./gallery.css";

/*
 * Both site sheets, in the top page's order, and that is deliberate.
 *
 * portfolio.css is named "top page scaffold" but its first 170 lines are
 * neither: the box-sizing reset, the body type, and the chrome every document
 * on this site uses — .skip-link, .badge, .cta, .engine-chip, .nav-toggle.
 * harbor.html and atelier.html load theme.css alone, which is why the
 * harbour's detail dialog opens at the browser's default sizing and why
 * theme.css:405 carries a note about an aria-live region that matched no rule
 * on any page. Loading half the pair is how a page ends up styled by accident;
 * this one shipped a permanently visible skip link and unstyled CTAs until the
 * first screenshot showed it.
 *
 * The other repair — hoisting reset + chrome up into theme.css — would hand
 * harbor and atelier a box-sizing and a body font they have never had, on two
 * pages this change has no business touching. So this page takes the pair
 * whole: measured, 4,057 gzip bytes of mostly-unused rules, on a document that
 * is about to load 177 KB of WebGPU renderer.
 */

watchOsPreference();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GalleryPage />
  </StrictMode>
);
