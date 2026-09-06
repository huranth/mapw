import { fileURLToPath, URL } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Bundle @bridgespace/backend (TS-source) into the main bundle; externalize every other dep.
    plugins: [externalizeDepsPlugin({ exclude: ["@bridgespace/backend"] })],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL("electron/main.ts", import.meta.url)) },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL("electron/preload.ts", import.meta.url)) },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL("src", import.meta.url)),
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: { index: fileURLToPath(new URL("src/index.html", import.meta.url)) },
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("recharts")) return "charts";
              if (id.includes("@xyflow")) return "flow";
              if (id.includes("@xterm")) return "xterm";
              if (id.includes("react") || id.includes("zustand")) return "vendor";
              return "vendor";
            }
          },
        },
      },
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
    },
    plugins: [react()],
  },
});
