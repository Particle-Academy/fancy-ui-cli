import { describe, expect, it } from "vitest";
import { resolveBackendFlag } from "../src/index.js";
import { detectBackend, plan } from "../src/commands/add-node.js";
import { rewritePhpNamespace, resolveNodeTargetPath } from "../src/config.js";
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
  ({
    schemaVersion: 1,
    name: "particle-academy/fancy-flow-nodes",
    kind: "@pa/thing",
    ui: ["ui"],
    runtimes,
    fixtures: "f.json",
    files: [],
  }) as NodeManifest;

const BOTH = manifest({
  ts: { files: ["js"], engine: ">=0.30.0" },
  php: { files: ["php"], engine: ">=0.9.0" },
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

describe("which source gets copied", () => {
  it("copies the UI and the PHP backend for a Laravel host", () => {
    // Not the JS executor: that project runs the graph on PHP and would end up
    // with two implementations of a node it runs once.
    expect(plan(BOTH, "php").parts).toEqual(["ui", "php"]);
  });

  it("copies the UI and the JS backend for a Node host", () => {
    expect(plan(BOTH, "js").parts).toEqual(["ui", "js"]);
  });

  it("still copies the UI when the chosen backend is missing, and says so", () => {
    // A node you can see and cannot run is at least legible; one that is
    // neither is a silent failure.
    const tsOnly = manifest({ ts: { files: ["js"], engine: ">=0.30.0" } });
    const result = plan(tsOnly, "php");

    expect(result.problem).toMatch(/no php backend/i);
    expect(result.parts).toContain("ui");
  });

  it("copies only php for a node that publishes no UI", () => {
    const phpOnly = { ...manifest({ php: { files: ["php"], engine: ">=0.9.0" } }), ui: undefined };

    expect(plan(phpOnly as any, "php").parts).toEqual(["php"]);
  });
});

describe("--backend=none", () => {
  it("is a real choice, not a typo", () => {
    for (const value of ["none", "ui", "ui-only"]) {
      expect(resolveBackendFlag(value)).toBe("none");
    }
  });

  it("copies the surface and nothing else", () => {
    expect(plan(BOTH, "none").parts).toEqual(["ui"]);
  });

  it("reports no problem for the backend it was told not to want", () => {
    // Asked for no backend, so a missing one is what was requested — warning
    // about it would be the tool arguing with an explicit instruction.
    expect(plan(BOTH, "none").problem).toBeUndefined();
    expect(plan(manifest({}), "none").problem).toBeUndefined();
  });
});

describe("vendored PHP lands in the project's namespace", () => {
  // PHP resolves a class by its namespace. A node's source declares
  // `FancyFlow\Nodes\<Node>` — correct in the marketplace repo, wrong the
  // moment it is copied into an app. Left alone every vendored PHP node is
  // unautoloadable: the file is there, the class is not.
  const config = { registry: "https://x", aliases: { components: "@/components", utils: "@/lib" }, rsc: false, tsx: true, tailwind: { css: "app.css" } } as any;

  it("rewrites the declaration to the configured root", () => {
    const out = rewritePhpNamespace("namespace FancyFlow\\Nodes\\GitPrOpen;", config);

    expect(out).toBe("namespace App\\Flow\\Nodes\\GitPrOpen;");
  });

  it("rewrites a sibling import too", () => {
    // A node's executor imports its own GitHost. Half-rewriting fails further
    // from the cause than not rewriting at all.
    const out = rewritePhpNamespace("use FancyFlow\\Nodes\\GitPrOpen\\GitHost;", config);

    expect(out).toBe("use App\\Flow\\Nodes\\GitPrOpen\\GitHost;");
  });

  it("follows dirs.flowNodesPhp when the project configures one", () => {
    const custom = { ...config, dirs: { components: "resources/js/components", flowNodesPhp: "app/Workflow/nodes" } };

    expect(rewritePhpNamespace("namespace FancyFlow\\Nodes\\X;", custom)).toBe(
      "namespace App\\Workflow\\Nodes\\X;",
    );
  });

  it("leaves the engine's own imports alone", () => {
    // `use FancyFlow\Contracts\NodeExecutor` points at the engine, which the
    // project really does install. Rewriting it would break the import.
    const src = "use FancyFlow\\Contracts\\NodeExecutor;\nuse FancyFlow\\Runtime\\Port;";

    expect(rewritePhpNamespace(src, config)).toBe(src);
  });
});

describe("the vendored PHP path agrees with its namespace", () => {
  // The two halves of one promise: rewritePhpNamespace decides what the class
  // is CALLED, resolveNodeTargetPath decides where it LIVES. PSR-4 only works
  // if they agree, and nothing checked that they did.
  //
  // They did not. The namespace became `App\\Flow\\Nodes\\GitPrOpen` while the file
  // landed at `app/Flow/Nodes/git-pr-open/php/` — kebab-cased, with an extra
  // segment. Composer could not autoload it, so the node installed cleanly,
  // looked right in the file list, and the class did not exist at run time.
  // Reported by the Moic Suite integration, who patched it by hand per node.
  const config = {
    registry: "https://x",
    aliases: { components: "@/components", utils: "@/lib" },
    rsc: false,
    tsx: true,
    tailwind: { css: "app.css" },
  } as any;

  const norm = (p: string) => p.split(String.fromCharCode(92)).join("/");

  it("PascalCases the node directory and drops the php segment", () => {
    const p = norm(resolveNodeTargetPath(config, "git-pr-open/php/GitHost.php", "/app"));

    expect(p).toBe("/app/app/Flow/Nodes/GitPrOpen/GitHost.php");
    expect(p).not.toContain("git-pr-open");
    expect(p).not.toContain("/php/");
  });

  it("puts the class exactly where its rewritten namespace says it is", () => {
    // The invariant, asserted rather than described: the rewritten namespace,
    // turned back into a path, must be the path the CLI writes to.
    const ns = rewritePhpNamespace("namespace FancyFlow\\Nodes\\GitPrOpen;", config)
      .replace("namespace ", "")
      .replace(";", "");

    const fromNamespace = "/app/" + ns.split(String.fromCharCode(92)).join("/") + "/GitHost.php";
    const fromResolver = norm(resolveNodeTargetPath(config, "git-pr-open/php/GitHost.php", "/app"));

    // Case-insensitive: Laravel maps `App\\` to `app/`, so only the segments
    // below the root must match character for character.
    expect(fromResolver.toLowerCase()).toBe(fromNamespace.toLowerCase());
  });

  it("leaves non-PHP targets on the registry path", () => {
    const p = norm(resolveNodeTargetPath(config, "git-pr-open/ui/kind.ts", "/app"));

    expect(p).toContain("git-pr-open/ui/kind.ts");
  });
});
