import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addNode } from "../src/commands/add-node.js";
import { writeConfig, type FancyConfig } from "../src/config.js";

/**
 * What `add node` says a node came from.
 *
 * It printed `manifest.name` beside the kind. Every first-party manifest set
 * that to `particle-academy/fancy-flow-nodes`, a package that never existed, so
 * every first-party install told the developer (or agent) reading it that the
 * node came from a package, and one ran `composer require` on it into a 404.
 *
 * A node is vendored, and the one source the CLI actually knows is the registry
 * it fetched the node from. That is what gets printed now. A first-party node
 * has no package, so its manifest's `name` is never echoed, including while a
 * registry is still serving the old field.
 */

const REGISTRY = "https://ui.particle.academy";

let dir: string;
let out: string[];

const config: FancyConfig = {
  registry: REGISTRY,
  aliases: { components: "@/components/fancy", utils: "@/lib/utils" },
  rsc: false,
  tsx: true,
  tailwind: { css: "src/index.css" },
  dirs: { components: "src/components/fancy" },
};

/** Serve one node the way `/r/nodes/*` serves it. */
function serveNode(slug: string, manifest: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (body: unknown, status = 200): Response =>
      ({ ok: status === 200, status, statusText: "OK", json: async () => body }) as Response;

    if (url === `${REGISTRY}/r/nodes/index.json`) {
      return json({
        items: [
          {
            kind: manifest.kind,
            ...(manifest.name === undefined ? {} : { name: manifest.name }),
            title: "Node",
            description: "",
            category: "io",
            runtimes: ["ts", "php"],
            verified: true,
            url: `/r/nodes/${slug}.json`,
          },
        ],
      });
    }
    if (url === `${REGISTRY}/r/nodes/${slug}.json`) return json(manifest);

    return json({ error: "not found" }, 404);
  }) as typeof fetch;
}

function node(overrides: Record<string, unknown>): Record<string, unknown> {
  const kind = String(overrides.kind);
  const dirName = kind.split("/").pop()!.replace(/_/g, "-");

  return {
    schemaVersion: 1,
    ui: ["ui"],
    runtimes: { ts: { files: ["js"], engine: ">=0.30.0" }, php: { files: ["php"], engine: ">=0.9.0" } },
    fixtures: "fixtures.json",
    verified: true,
    files: [{ target: `${dirName}/ui/kind.ts`, content: "export {};\n" }],
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fancy-add-node-"));
  await writeConfig(config, dir);
  out = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("add node names where a node came from", () => {
  it("never prints a package for a first-party node, even one whose manifest still names one", async () => {
    // Exactly what production served on 2026-09-13.
    serveNode(
      "particle-academy__ui_effect",
      node({ kind: "@particle-academy/ui_effect", name: "particle-academy/fancy-flow-nodes" }),
    );

    expect(await addNode(["ui_effect"], { backend: "none", install: false }, dir)).toBe(0);

    const printed = out.join("");
    expect(printed).toContain("@particle-academy/ui_effect");
    expect(printed).not.toContain("fancy-flow-nodes");
    expect(printed).toContain("from ui.particle.academy");
  });

  it("prints the registry for a first-party node that names no package", async () => {
    serveNode("particle-academy__ui_effect", node({ kind: "@particle-academy/ui_effect" }));

    await addNode(["ui_effect"], { backend: "none", install: false }, dir);

    const printed = out.join("");
    expect(printed).toContain("from ui.particle.academy");
    // An absent name must not surface as the string "undefined".
    expect(printed).not.toContain("undefined");
  });

  it("still names the package a community node is published from, beside the registry", async () => {
    serveNode(
      "acme__salesforce_upsert",
      node({ kind: "@acme/salesforce_upsert", name: "@acme/fancy-flow-salesforce" }),
    );

    await addNode(["@acme/salesforce_upsert"], { backend: "none", install: false }, dir);

    const printed = out.join("");
    expect(printed).toContain("@acme/fancy-flow-salesforce");
    expect(printed).toContain("from ui.particle.academy");
  });
});
