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
    manifest: true,
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    // 图表与基础运行时独立分块，其余依赖按页面复用关系拆分，避免登录页提前加载。
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "charts",
              test: /[\\/]node_modules[\\/](recharts|recharts-scale|victory-vendor|d3-[^\\/]+|@reduxjs|react-redux|redux|immer)[\\/]/,
              priority: 20,
              includeDependenciesRecursively: false,
            },
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 10,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
});
