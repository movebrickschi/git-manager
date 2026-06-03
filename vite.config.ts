import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync } from "fs";

const pkgVersion = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8")
).version as string;

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3847",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        /**
         * 手动 chunks 策略（已回退激进拆分）：
         *
         * - Monaco editor 走 vite 默认行为（不在 manualChunks 中分流），让 rollup
         *   按入口图自然形成 editor.main 单 chunk + 各 language chunks 副产品。
         *   原因：曾尝试按 basic-languages / language / contrib 三层细拆，结果
         *   index.html 被注入 160+ 个 modulepreload，Electron file:// 加载顺序
         *   不稳，导致渲染空白。Monaco editor.main ≈ 3 MB 是 Monaco 自身规模，
         *   要进一步瘦身只能走 features-only 入口（monaco-editor/esm/vs/editor/editor.api
         *   + 手动注册需要的 contrib），属于深度重构，不在本次范围。
         * - vue/pinia/@vue 走 vue-vendor
         * - splitpanes/lucide-vue-next 走 ui-vendor
         * - 其它 node_modules 走 vendor
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("monaco-editor")) return undefined;
          if (id.includes("vue") || id.includes("pinia") || id.includes("@vue")) {
            return "vue-vendor";
          }
          if (id.includes("splitpanes") || id.includes("lucide-vue-next")) {
            return "ui-vendor";
          }
          return "vendor";
        },
      },
    },
  },
});
