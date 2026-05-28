import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: "./",
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
         * 手动 chunks 策略：
         *
         * - Monaco editor 不再走单 chunk（原 3.3 MB），按 sub-module 拆分：
         *   * basic-languages/* → `monaco-lang-<name>`（每个语言一 chunk，仅在 ThreeWayMerge 真正用到时按需 load）
         *   * language/* （typescript/json/css/html 的语言服务）→ `monaco-lang-<name>`
         *   * editor/contrib/* （find/format/fold/links/snippet 等）→ `monaco-contrib-<group>`
         *   * 其余 esm/vs/* 主干 → `monaco-core`
         * - vue/pinia/@vue 走 vue-vendor
         * - splitpanes/lucide-vue-next 走 ui-vendor
         * - 其它 node_modules 走 vendor
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;

          // Monaco editor 细粒度拆分
          if (id.includes("monaco-editor")) {
            // 每种 basic language (typescript / python / go / ...) 单独 chunk
            const basicMatch = id.match(/monaco-editor[\\/]esm[\\/]vs[\\/]basic-languages[\\/]([^\\/]+)[\\/]/);
            if (basicMatch) return `monaco-lang-${basicMatch[1]}`;

            // language services (typescript/json/css/html 的 IntelliSense / worker)
            const langMatch = id.match(/monaco-editor[\\/]esm[\\/]vs[\\/]language[\\/]([^\\/]+)[\\/]/);
            if (langMatch) return `monaco-lang-${langMatch[1]}`;

            // editor/contrib/* 按子目录分组，避免单文件碎片化
            const contribMatch = id.match(/monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]contrib[\\/]([^\\/]+)[\\/]/);
            if (contribMatch) return `monaco-contrib-${contribMatch[1]}`;

            // platform / base / browser 等运行时基础 → 主 monaco-core chunk
            return "monaco-core";
          }

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
