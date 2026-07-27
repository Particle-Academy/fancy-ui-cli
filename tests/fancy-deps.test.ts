import { describe, expect, it } from "vitest";
import { installRoutes, renderFancyDependencies } from "../src/commands/add-node.js";
import type { FancyDependency, NodeManifest } from "../src/nodes.js";

/**
 * A node's Fancy suite dependencies, and the routes offered for each.
 *
 * A node is COPIED into a project, not installed, so nothing resolves its
 * imports for it. Without this the first sign that `llm_screen` needs
 * fancy-screens is a module-not-found at build time, naming a package the
 * consumer never chose and cannot place.
 */
const SCREENS: FancyDependency = {
  package: "fancy-screens",
  npm: "@particle-academy/fancy-screens",
  reason: "renders the generated interface",
};

const FMS: FancyDependency = {
  package: "laravel-fms",
  composer: "particle-academy/laravel-fms",
};

const manifest = (fancyDependencies?: FancyDependency[]): NodeManifest =>
  ({
    schemaVersion: 1,
    name: "particle-academy/fancy-flow-nodes",
    kind: "@pa/thing",
    ui: ["ui"],
    runtimes: { ts: { files: ["js"], engine: ">=0.30.0" } },
    fixtures: "f.json",
    files: [],
    fancyDependencies,
  }) as NodeManifest;

describe("install routes", () => {
  it("offers npm on a PHP host too, because the editor is React everywhere", () => {
    // The UI comes down whichever backend you pick, so an npm-only package is
    // needed in a Laravel app as much as in a Node one.
    expect(installRoutes(SCREENS, "php", "npm").map((r) => r.label)).toEqual(["npm", "vendor"]);
  });

  it("withholds composer from a Node project", () => {
    // Printing `composer require` to a project with no composer.json is an
    // instruction that cannot be followed.
    expect(installRoutes(FMS, "js", "npm").map((r) => r.label)).toEqual(["vendor"]);
    expect(installRoutes(FMS, "php", "npm").map((r) => r.label)).toEqual(["composer", "vendor"]);
  });

  it("always offers vendoring, which needs no registry at all", () => {
    expect(installRoutes(SCREENS, "none", "npm").at(-1)).toEqual({
      label: "vendor",
      cmd: "fancy-cli add fancy-screens",
    });
  });

  it("uses the project's own package manager", () => {
    expect(installRoutes(SCREENS, "js", "pnpm")[0].cmd).toContain("pnpm");
    expect(installRoutes(SCREENS, "js", "bun")[0].cmd).toContain("bun");
  });
});

describe("rendering", () => {
  it("prints nothing when a node needs nothing — most do not", () => {
    expect(renderFancyDependencies(manifest(), "js", "npm")).toBe("");
    expect(renderFancyDependencies(manifest([]), "js", "npm")).toBe("");
  });

  it("names the package, why it is needed, and every route", () => {
    const out = renderFancyDependencies(manifest([SCREENS]), "js", "npm");

    expect(out).toContain("fancy-screens");
    expect(out).toContain("renders the generated interface");
    expect(out).toContain("npm install @particle-academy/fancy-screens");
    expect(out).toContain("fancy-cli add fancy-screens");
  });

  it("distinguishes a package the node degrades without", () => {
    const out = renderFancyDependencies(manifest([{ ...SCREENS, requirement: "optional" }]), "js", "npm");

    expect(out).toContain("optional");
    expect(out).not.toContain("needed");
  });

  it("never prints a version", () => {
    // The contract's whole point: the suite ships additively and often, and a
    // range printed here gets pasted into a manifest — arriving as the pin the
    // validator refuses, by the back door.
    const out = renderFancyDependencies(manifest([SCREENS, FMS]), "php", "npm");

    expect(out).not.toMatch(/@\^|@~|@\d|:\^|:\d/);
  });
});
