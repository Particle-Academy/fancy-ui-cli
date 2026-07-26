import { describe, expect, it } from "vitest";
import { resolveBackendFlag } from "../src/index.js";
import { detectBackend, plan } from "../src/commands/add-node.js";
import type { NodeManifest } from "../src/nodes.js";

/**
 * Which runtime executes a node, and what that means for what gets installed.
 *
 * A node is a UI *and* a backend. Treating `ts` and `php` as two interchangeable
 * runtimes and installing whichever the project "is" leaves a Laravel app with a
 * node it can execute and cannot see — installed, no palette entry, no config
 * panel. So the UI comes down either way and the backend choice only decides
 * what runs the graph.
 */
const manifest = (runtimes: NodeManifest["runtimes"]): NodeManifest =>
  ({ schemaVersion: 1, name: "@pa/nodes", kind: "@pa/thing", runtimes, fixtures: "f.json" }) as NodeManifest;

const BOTH = manifest({
  ts: { entry: "./dist/thing.js", engine: ">=0.30.0" },
  php: { package: "pa/nodes:^0.1", engine: ">=0.9.0" },
});

describe("--backend", () => {
  it("accepts each ecosystem's common spellings", () => {
    for (const value of ["php", "PHP", " laravel ", "composer"]) {
      expect(resolveBackendFlag(value)).toBe("php");
    }
    for (const value of ["js", "ts", "node", "npm", "TypeScript"]) {
      expect(resolveBackendFlag(value)).toBe("js");
    }
  });

  it("means 'detect it' only when genuinely absent", () => {
    expect(resolveBackendFlag(undefined)).toBeUndefined();
    expect(resolveBackendFlag("")).toBeUndefined();
  });

  it("rejects a typo instead of silently detecting", () => {
    // Passing the flag means you did not want the guess. Falling back to it
    // would do the opposite of what was asked, quietly.
    expect(() => resolveBackendFlag("pph")).toThrow(/Unknown backend/);
  });
});

describe("detection", () => {
  it("picks php when the project has a composer.json", () => {
    expect(detectBackend({ require: {} })).toBe("php");
  });

  it("picks js when it does not", () => {
    expect(detectBackend(undefined)).toBe("js");
  });

  it("picks php for an Inertia app, which has both manifests", () => {
    // PHP runs the workflow there; npm is only carrying the editor.
    expect(detectBackend({ require: { "laravel/framework": "^13.0" } })).toBe("php");
  });
});

describe("what gets installed", () => {
  it("installs the UI and the PHP backend for a Laravel host", () => {
    expect(plan(BOTH, "php")).toEqual({ npm: ["@pa/nodes"], composer: ["pa/nodes:^0.1"] });
  });

  it("installs only npm for a Node host — the UI and executor are one package", () => {
    expect(plan(BOTH, "js")).toEqual({ npm: ["@pa/nodes"], composer: [] });
  });

  it("still installs the UI when the chosen backend is missing, and says so", () => {
    const tsOnly = manifest({ ts: { entry: "./dist/thing.js", engine: ">=0.30.0" } });
    const result = plan(tsOnly, "php");

    expect(result.problem).toMatch(/no php backend/i);
    expect(result.composer).toEqual([]);
  });

  it("reports a node with no UI rather than inventing one", () => {
    const phpOnly = manifest({ php: { package: "pa/nodes:^0.1", engine: ">=0.9.0" } });

    expect(plan(phpOnly, "php")).toEqual({ npm: [], composer: ["pa/nodes:^0.1"] });
  });
});
