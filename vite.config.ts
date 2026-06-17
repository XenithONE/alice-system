import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

export default defineConfig({
  base: "/alice-system/",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 6000
  },
  server: {
    host: "127.0.0.1"
  },
  preview: {
    host: "127.0.0.1"
  }
});
