import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PortfolioApp from "./portfolio/App";
import "./portfolio/portfolio.css";
import "./portfolio/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortfolioApp />
  </StrictMode>
);
