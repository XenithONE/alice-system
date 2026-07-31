import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./kart.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
