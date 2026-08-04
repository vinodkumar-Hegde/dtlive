import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5192,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://backend:8092",
        changeOrigin: false,
      },
      "/ws": {
        target: "ws://backend:8092",
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
