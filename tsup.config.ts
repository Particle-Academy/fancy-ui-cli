import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  // Single source of truth for the version the binary reports. A literal in
  // src/ drifted from package.json twice.
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  format: ["esm"],
  target: "node18",
  platform: "node",
  // Preserve the executable shebang on the bin entry.
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Zero runtime dependencies — nothing to bundle from node_modules.
  external: [],
});
