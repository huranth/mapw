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
      rollupOptions: {
        input: { index: fileURLToPath(new URL("src/index.html", import.meta.url)) },
      },
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
    },
    plugins: [react()],
  },
});
