import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173, strictPort: false },
  preview: { host: true, port: 4173 },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        handbook: "handbook.html",
      },
    },
  },
});
