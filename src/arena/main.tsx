import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./arena.css";

const root = document.getElementById("root");
if (!root) throw new Error("SCRAP CROWN root element was not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
