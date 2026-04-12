import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/ws": {
        target: process.env.BACKEND_WS_URL ?? "ws://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
