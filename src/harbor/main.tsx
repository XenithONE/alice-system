import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { HarborPage } from "./HarborPage";
import type { Work } from "../data/works";
import { GameDetail } from "../portfolio/components/GameDetail";
import "../portfolio/theme.css";
import "./harbor.css";

/*
 * The walkable harbour, on its own page.
 *
 * It used to be the top page's hero, which meant every visitor downloaded
 * three.js (147 KB gzip) and a 384 KB poster before they could read a single
 * word about the games. Here it costs that only to people who came for it.
 *
 * theme.css carries the shared dark palette and editorial chrome, exactly as
 * on the top page — the harbour never had a look of its own, it had the
 * site's look plus its own furniture.
 */
function HarborApp() {
  const [detail, setDetail] = useState<Work | null>(null);
  return (
    <>
      <HarborPage onOpenDetail={setDetail} />
      <GameDetail work={detail} onClose={() => setDetail(null)} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HarborApp />
  </StrictMode>
);
