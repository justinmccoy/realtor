import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Local dev: either set VITE_API_BASE to the deployed API endpoint (CORS
// allows localhost:5173), or set VITE_API_PROXY to proxy /api same-origin.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: process.env.VITE_API_PROXY
      ? {
          "/api": {
            target: process.env.VITE_API_PROXY,
            changeOrigin: true
          }
        }
      : undefined
  },
  build: { outDir: "dist", sourcemap: mode !== "production" }
}));
