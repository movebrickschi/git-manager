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
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("monaco-editor")) return undefined;
            if (id.includes("vue") || id.includes("pinia") || id.includes("@vue"))
              return "vue-vendor";
            if (id.includes("splitpanes") || id.includes("lucide-vue-next"))
              return "ui-vendor";
            return "vendor";
          }
        },
      },
    },
  },
});
