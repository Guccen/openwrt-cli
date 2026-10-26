import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./frontend/src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    proxy: process.env.OPENWRT_API_URL
      ? {
          "/ubus": { target: process.env.OPENWRT_API_URL, changeOrigin: true },
          "/device.json": { target: process.env.OPENWRT_API_URL, changeOrigin: true },
        }
      : undefined,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
