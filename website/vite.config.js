import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173, strictPort: false },
  preview: { host: true, port: 4173 },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: "index.html",
        handbook: "handbook.html",
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("three")) return "vendor-three";
            if (id.includes("gsap")) return "vendor-gsap";
            if (id.includes("@supabase")) return "vendor-supabase";
          }
        },
      },
    },
  },
});
