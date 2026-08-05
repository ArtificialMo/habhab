import { defineConfig } from "vite";

export default defineConfig({
  // 5178 is taken by a sibling project's dev server on this machine; pinned here so
  // the two cannot be confused for each other again.
  server: { port: 5179, strictPort: true, host: true },
  // Havok ships a hand-rolled ESM wrapper around its wasm; pre-bundling it breaks
  // the `locateFile` override we use in src/core/physics.ts.
  optimizeDeps: { exclude: ["@babylonjs/havok"] },
  build: {
    target: "es2022",
    // The Sites asset binding is unreliable for secondary chunks, so the
    // share artifact must contain Babylon's dynamic shader modules too.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
