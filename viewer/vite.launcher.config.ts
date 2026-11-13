import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** The launcher page served by `schemamap ui`: its own single file, beside the map (D-059). */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist-launcher",
    emptyOutDir: true,
    rollupOptions: { input: "launcher.html" },
  },
});
