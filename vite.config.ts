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
        "/ubus": { target: process.env.OPENWRT_API_URL, changeOrigin: true, secure: false },
        "/device.json": { target: process.env.OPENWRT_API_URL, changeOrigin: true, secure: false },
      }
      : undefined,
  },
  build: {
    manifest: true,
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    // React 独立分块；图表随概况页按需加载，避免跨分块循环依赖。
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
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
