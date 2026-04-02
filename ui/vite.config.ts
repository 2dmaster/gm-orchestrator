import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4242",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:4242",
        ws: true,
      },
    },
  },
});
