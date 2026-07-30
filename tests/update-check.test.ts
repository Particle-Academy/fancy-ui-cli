import { describe, it, expect } from "vitest";
import { isOlder, warnIfOutdated } from "../src/update-check.js";
import { checkSchemaVersion, checkNodeCompat, SUPPORTED_SCHEMA_VERSION } from "../src/nodes.js";
import type { NodeManifest } from "../src/nodes.js";

/**
 * Two halves of the same problem: a developer running a CLI far older than the
 * one we publish, and never being told.
 *
 * Node CONTENT needs no CLI update — `add node` reads the live registry. CLI
 * FEATURES are the opposite, and `npx` caches by package name, so plain
 * `npx fancy-cli …` happily reuses a copy from months ago. Every install string
 * we published said exactly that rather than `npx fancy-cli@latest …`, so the
 * stale copy was what most people had.
 *
 * `schemaVersion` was on the manifest type from the very first release and was
 * **never read**. An old CLI meeting a newer node did not fail — it installed
 * the parts it recognised and dropped the rest in silence.
 */
const manifest = (over: Partial<NodeManifest> = {}): NodeManifest =>
  ({
    schemaVersion: 1,
    name: "@particle-academy/demo",
    kind: "@particle-academy/demo",
    package: "fancy-flow-nodes",
    runtimes: { js: { npm: "@particle-academy/demo" } },
    ...over,
  }) as NodeManifest;

describe("isOlder", () => {
  it("detects a newer published version at every level", () => {
    expect(isOlder("0.5.0", "0.5.1")).toBe(true);
    expect(isOlder("0.5.0", "0.6.0")).toBe(true);
    expect(isOlder("0.5.0", "1.0.0")).toBe(true);
  });

  it("is quiet when current or ahead", () => {
    expect(isOlder("0.5.0", "0.5.0")).toBe(false);
    expect(isOlder("0.6.0", "0.5.9")).toBe(false);
    // A local dev build ahead of the registry must not nag on every command.
    expect(isOlder("1.0.0", "0.9.9")).toBe(false);
  });

  it("does not mistake 10 for 1 — the classic string-compare bug", () => {
    expect(isOlder("0.9.0", "0.10.0")).toBe(true);
    expect(isOlder("0.10.0", "0.9.0")).toBe(false);
  });

  it("treats an unparseable version as oldest rather than throwing", () => {
    expect(isOlder("not-a-version", "0.5.0")).toBe(true);
  });
});

describe("warnIfOutdated", () => {
  it("says something actionable when a newer version exists", async () => {
    const out = await warnIfOutdated("0.4.0", {}, async () => "0.5.0");

    expect(out).toContain("0.5.0");
    // The hint is worthless without the actual remedy — @latest is the fix,
    // because the cached copy is the cause.
    expect(out).toContain("npx fancy-cli@latest");
  });

  it("says nothing when up to date", async () => {
    expect(await warnIfOutdated("0.5.0", {}, async () => "0.5.0")).toBeNull();
  });

  it("says nothing when the registry cannot be reached", async () => {
    // Offline, proxied, or blocked. A version check that breaks the tool, or
    // even just nags on a plane, is worse than no version check.
    expect(await warnIfOutdated("0.1.0", {}, async () => null)).toBeNull();
  });

  it("can be switched off entirely", async () => {
    const out = await warnIfOutdated("0.1.0", { FANCY_CLI_NO_UPDATE_CHECK: "1" }, async () => "9.9.9");

    expect(out).toBeNull();
  });
});

describe("checkSchemaVersion", () => {
  it("accepts a manifest at the supported version", () => {
    expect(checkSchemaVersion(manifest({ schemaVersion: SUPPORTED_SCHEMA_VERSION }))).toEqual([]);
  });

  it("accepts a manifest with no schemaVersion at all", () => {
    // Every node published before this check shipped omits it — none of them
    // may start failing to install.
    const m = manifest();
    delete (m as { schemaVersion?: number }).schemaVersion;

    expect(checkSchemaVersion(m)).toEqual([]);
  });

  it("REFUSES a manifest newer than this CLI, and says how to fix it", () => {
    const problems = checkSchemaVersion(manifest({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 }));

    expect(problems).toHaveLength(1);
    expect(problems[0]?.level).toBe("error");
    expect(problems[0]?.message).toContain("npx fancy-cli@latest");
    // Must name the real consequence — "would install only the parts it
    // recognises" is the whole reason this is an error and not a warning.
    expect(problems[0]?.message).toMatch(/silently|drop|only the parts/i);
  });

  it("surfaces through checkNodeCompat even when the runtime is undetectable", () => {
    // The undetectable-runtime branch used to `return` a fresh array, which
    // discarded this error — hiding "your CLI is too old" behind "I can't tell
    // your runtime", the less fundamental of the two.
    const problems = checkNodeCompat(manifest({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 }), {
      runtimes: [],
      versions: {},
    });

    expect(problems.some((p) => p.level === "error" && /schema v/.test(p.message))).toBe(true);
  });
});
