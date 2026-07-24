import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PortfolioApp from "./portfolio/App";
import "./portfolio/portfolio.css";
import "./portfolio/harbor.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortfolioApp />
  </StrictMode>
);
