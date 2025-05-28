import { defineConfig } from "tsup";

export default defineConfig([
  // Library build (dual ESM/CJS)
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: "dist",
  },
  // CLI build (ESM with shebang)
  {
    entry: ["tilt.ts"],
    format: ["cjs","esm"],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
    onSuccess: "chmod +x dist/tilt.js",
  },
]);
