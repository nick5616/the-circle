import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      // http-proxy requires an http:// target even for WebSocket proxying;
      // ws:true tells it to upgrade the connection itself.
      "/ws": {
        target: process.env.BACKEND_URL ?? "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: process.env.BACKEND_URL ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
