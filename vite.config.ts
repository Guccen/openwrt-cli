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
    // 合并共享依赖以提高压缩率，业务页面继续按路由加载，保持固件资源预算。
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor", test: /[\\/]node_modules[\\/]/ },
            { name: "shared", minShareCount: 2, includeDependenciesRecursively: false },
          ],
        },
      },
    },
  },
});
