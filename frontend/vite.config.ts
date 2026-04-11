import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/ws": {
        target: "ws://backend:8000",
        ws: true,
      },
    },
  },
});
