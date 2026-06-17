import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/alice-system/",
  plugins: [react()],
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
