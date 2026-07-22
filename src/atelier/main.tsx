import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GlRoot } from "../portfolio/gl/GlRoot";
import "./atelier.css";

const BASE = import.meta.env.BASE_URL;

function AtelierApp() {
  return (
    <div className="atelier">
      {/* Poster paints first / stands in if WebGL is unavailable. */}
      <div
        className="atelier-poster"
        style={{ backgroundImage: `url("${BASE}assets/atelier-adrift-cover.jpg")` }}
        aria-hidden="true"
      />
      <GlRoot />

      <header className="atelier-chrome">
        <a className="atelier-back" href={BASE}>
          <span aria-hidden="true">←</span> AlicE sYsTeM
        </a>
        <div className="atelier-tag">
          <p className="atelier-eyebrow">THREE.JS EXPERIMENT · 実験作</p>
          <h1 className="atelier-title">ATELIER ADRIFT</h1>
          <p className="atelier-sub">
            ローポリの海の実験室 — dFdx 面取り海シェーダ ＋ 合成正弦波 ＋ 木造帆船
          </p>
          <p className="atelier-version">v2 — BRICK UPDATE</p>
        </div>
      </header>

      <p className="atelier-hint" aria-hidden="true">
        マウスを動かすと視点が揺れます · スクロール不要
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AtelierApp />
  </StrictMode>
);
