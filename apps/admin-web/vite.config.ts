import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5174,
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
