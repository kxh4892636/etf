import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: "client",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./client", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: { outDir: "../dist/client", emptyOutDir: true },
  // 编辑器/代理的原子写会在源目录旁生成临时目录，Windows 下 watcher 监听它会 EBUSY 崩溃。
  server: { watch: { ignored: ["**/.*.tmpdir/**", "**/*.tmp"] } },
});
