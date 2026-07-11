import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import pkg from "./package.json";

export default defineConfig({
  base: "/alice-system/",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: {
        portfolio: fileURLToPath(new URL("./index.html", import.meta.url)),
        "hollow-ward": fileURLToPath(new URL("./hollow-ward.html", import.meta.url)),
        "tower-defense": fileURLToPath(new URL("./tower-defense.html", import.meta.url))
      },
      // NOTE: no manualChunks here on purpose. rolldown-vite's manualChunks compat
      // folded three's core into the spark group even when the function returned
      // "three" for it, which made the portfolio's lazy hero pull the 5MB spark
      // chunk. Rolldown's automatic chunking splits shared modules correctly:
      // spark stays exclusive to the hollow-ward entry graph.
      output: {}
    }
  },
  server: {
    host: "127.0.0.1"
  },
  preview: {
    host: "127.0.0.1"
  }
});
