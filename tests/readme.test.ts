import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isOlder } from "../src/update-check.js";

/**
 * The README is what npmjs.com shows, and what ui.particle.academy compiles
 * into its fancy-cli docs page. It told readers to pin `npx fancy-cli@0.1.0`
 * — a release with no `add node`, no update check, and none of the 0.8.2 fix
 * for first-party nodes (0.8.1 and older print `undefined` beside one).
 *
 * Bare `npx fancy-cli …` is the quieter form of the same problem: npx caches by
 * package name, so it keeps running whatever copy it fetched first. That is why
 * 0.6.0 moved every install string to `@latest`; the command reference in this
 * file was missed.
 */
const OLDEST_ACCEPTABLE = "0.8.2";
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README invocations", () => {
  it("never pins a CLI older than the first-party node fix", () => {
    const pins = [...readme.matchAll(/fancy-cli@(\d+\.\d+\.\d+)/g)].map((m) => m[1]!);
    const stale = pins.filter((v) => isOlder(v, OLDEST_ACCEPTABLE));

    expect(stale).toEqual([]);
  });

  it("never shows an unpinned npx invocation", () => {
    const bare = readme.split("\n").filter((line) => /npx (?:-y )?fancy-cli(?!@)/.test(line));

    expect(bare).toEqual([]);
  });
});
