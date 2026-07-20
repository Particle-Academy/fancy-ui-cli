import { describe, it, expect } from "vitest";
import {
  satisfiesRange,
  detectHostRuntimes,
  checkNodeCompat,
  type NodeManifest,
} from "../src/nodes.js";
import { filterNodes, renderNodes } from "../src/commands/nodes.js";
import { resolveInstallFlag } from "../src/index.js";

const manifest: NodeManifest = {
  schemaVersion: 1,
  name: "@acme/fancy-flow-salesforce",
  kind: "@acme/salesforce_upsert",
  runtimes: {
    ts: { entry: "dist/executor.js", engine: "^0.16" },
    php: { package: "acme/fancy-flow-salesforce:^0.1", engine: "^0.8" },
  },
  fixtures: "fixtures/salesforce_upsert.json",
};

describe("satisfiesRange", () => {
  // THE SHARED CASE TABLE. An identical table exists in fancy-flow's
  // marketplace.test.ts and fancy-flow-php's MarketplaceTest.php. Three
  // implementations exist so a zero-dependency CLI does not have to pull in a
  // workflow engine; this table is what keeps them from drifting apart. Change
  // one, change all three.
  it.each([
    ["0.15.1", "^0.15", true],
    ["0.16.0", "^0.15", false], // pre-1.0: a minor bump is breaking
    ["1.2.0", "^1.0", true],
    ["2.0.0", "^1.0", false],
    ["0.7.0", ">=0.7", true],
    ["0.5.0", ">=0.7", false],
    ["0.7.3", "~0.7.1", true],
    ["0.8.0", "~0.7.1", false],
    ["9.9.9", "*", true],
    ["0.7.0", "^0.5 || ^0.7", true],
    ["1.0.0", "not-a-range", false],
  ])("%s against %s is %s", (version, range, expected) => {
    expect(satisfiesRange(version as string, range as string)).toBe(expected);
  });
});

describe("detectHostRuntimes", () => {
  it("reports both runtimes for a project running the split", () => {
    // The setup this whole mechanism exists for: TS editor, PHP execution.
    const host = detectHostRuntimes(
      { dependencies: { "@particle-academy/fancy-flow": "^0.16.0" } },
      { require: { "particle-academy/fancy-flow-php": "^0.8.0" } },
    );

    expect(host.runtimes).toEqual(["ts", "php"]);
    expect(host.versions).toEqual({ ts: "0.16.0", php: "0.8.0" });
  });

  it("reports nothing rather than guessing when neither engine is present", () => {
    // A wrong answer here produces a confident check against a runtime the
    // project does not use, which is worse than no check.
    expect(detectHostRuntimes({ dependencies: { react: "^19" } }, undefined)).toEqual({
      runtimes: [],
      versions: {},
    });
  });

  it("finds the engine in devDependencies too", () => {
    const host = detectHostRuntimes({ devDependencies: { "@particle-academy/fancy-flow": "0.16.0" } }, undefined);
    expect(host.runtimes).toEqual(["ts"]);
  });

  it("survives a malformed manifest", () => {
    expect(detectHostRuntimes("not json", 42).runtimes).toEqual([]);
  });
});

describe("checkNodeCompat", () => {
  it("passes when every host runtime is implemented and in range", () => {
    const host = { runtimes: ["ts", "php"], versions: { ts: "0.16.0", php: "0.8.0" } };
    expect(checkNodeCompat(manifest, host)).toEqual([]);
  });

  it("errors on the TS-only package in a PHP project", () => {
    // The node would install, appear in the palette, and then fail to run.
    const tsOnly: NodeManifest = { ...manifest, runtimes: { ts: { entry: "x.js", engine: "^0.16" } } };
    const problems = checkNodeCompat(tsOnly, { runtimes: ["php"], versions: { php: "0.8.0" } });

    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("error");
    expect(problems[0].message).toMatch(/fail to run/);
  });

  it("errors when the OTHER runtime's engine is too old", () => {
    // The failure a single engine range could not express.
    const problems = checkNodeCompat(manifest, {
      runtimes: ["ts", "php"],
      versions: { ts: "0.16.0", php: "0.5.0" },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("error");
    expect(problems[0].message).toMatch(/needs php engine \^0\.8, but this project has 0\.5\.0/);
  });

  it("warns rather than passing silently when a version cannot be read", () => {
    const problems = checkNodeCompat(manifest, { runtimes: ["ts"], versions: {} });
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("warning");
    expect(problems[0].message).toMatch(/was not checked/);
  });

  it("warns rather than guessing when no runtime could be detected", () => {
    const problems = checkNodeCompat(manifest, { runtimes: [], versions: {} });
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("warning");
    expect(problems[0].message).toMatch(/Could not tell which runtime/);
  });
});

describe("node search", () => {
  const items = [
    {
      kind: "@acme/salesforce_upsert",
      name: "@acme/fancy-flow-salesforce",
      title: "Salesforce Upsert",
      description: "Create or update a Salesforce record.",
      category: "integrations",
      runtimes: ["ts", "php"],
      verified: true,
      url: "/r/nodes/@acme/salesforce_upsert.json",
    },
    {
      kind: "@acme/route_llm",
      name: "@acme/fancy-flow-router",
      title: "Smart Router",
      description: "Let a model pick the branch.",
      category: "ai",
      runtimes: ["ts"],
      verified: false,
      url: "/r/nodes/@acme/route_llm.json",
    },
  ];

  it("matches on description, which is how a concept query finds a node", () => {
    // The failure mode is "didn't know it existed and wrote a bespoke one",
    // so matching only on the id would miss the queries that matter.
    expect(filterNodes(items, "model pick").map((i) => i.kind)).toEqual(["@acme/route_llm"]);
  });

  it("matches on category", () => {
    expect(filterNodes(items, "ai").map((i) => i.kind)).toEqual(["@acme/route_llm"]);
  });

  it("is case-insensitive", () => {
    expect(filterNodes(items, "SALESFORCE")).toHaveLength(1);
  });

  it("shows runtimes on every row", () => {
    // A node implementing only one runtime is unusable to half the audience,
    // and that has to be visible while browsing, not at install.
    const rendered = renderNodes(items);
    expect(rendered).toContain("[ts php]");
    expect(rendered).toContain("[ts]");
  });
});

describe("--no-install actually disables installing", () => {
  // Regression. Node's parseArgs does NOT negate `--no-install` into
  // `install: false` — it records a separate `no-install` key and leaves the
  // default true. Every `--no-install` since this CLI shipped ran the package
  // manager anyway, which for a tool that shells out to npm is doing the
  // opposite of what it was told. Found by running the binary, not by a test.
  it("parseArgs leaves install true — which is why index.ts reads both keys", async () => {
    const { parseArgs } = await import("node:util");
    const { values } = parseArgs({
      args: ["add", "card", "--no-install"],
      allowPositionals: true,
      strict: false,
      options: { install: { type: "boolean", default: true } },
    });

    expect(values.install).toBe(true);
    expect(values["no-install"]).toBe(true);
  });

  it.each([
    [{ install: true }, true],
    [{ install: true, "no-install": true }, false],
    [{ install: false }, false],
    [{}, true],
  ])("%o resolves to %s", (values, expected) => {
    // Tests the real exported resolution, not a copy of it.
    expect(resolveInstallFlag(values as Record<string, unknown>)).toBe(expected);
  });
});

describe("the hardcoded VERSION matches package.json", () => {
  // It drifted once: the binary reported 0.1.0 while 0.1.1 was published. The
  // comment claims the build keeps them in sync; nothing did.
  it("does not drift", async () => {
    const pkg = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        new URL("../package.json", import.meta.url),
        "utf8",
      ),
    );
    const src = await (await import("node:fs/promises")).readFile(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    const declared = /const VERSION = "([^"]+)"/.exec(src)?.[1];

    expect(declared).toBe(pkg.version);
  });
});
