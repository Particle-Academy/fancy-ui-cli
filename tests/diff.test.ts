import { describe, it, expect } from "vitest";
import { unifiedDiff } from "../src/diff.js";

describe("unifiedDiff", () => {
  it("returns empty string for identical input", () => {
    const t = "line one\nline two\nline three\n";
    expect(unifiedDiff(t, t)).toBe("");
  });

  it("produces a unified hunk for a changed line", () => {
    const a = "alpha\nbeta\ngamma\n";
    const b = "alpha\nBETA\ngamma\n";
    const out = unifiedDiff(a, b, { fromLabel: "local", toLabel: "registry" });
    expect(out).toContain("--- local");
    expect(out).toContain("+++ registry");
    expect(out).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(out).toContain("-beta");
    expect(out).toContain("+BETA");
    // Unchanged context lines are kept with a leading space.
    expect(out).toContain(" alpha");
    expect(out).toContain(" gamma");
  });

  it("handles pure additions", () => {
    const a = "one\ntwo\n";
    const b = "one\ntwo\nthree\n";
    const out = unifiedDiff(a, b);
    expect(out).toContain("+three");
    expect(out).not.toContain("-three");
  });

  it("handles pure deletions", () => {
    const a = "one\ntwo\nthree\n";
    const b = "one\nthree\n";
    const out = unifiedDiff(a, b);
    expect(out).toContain("-two");
  });

  it("normalizes CRLF without spurious diffs", () => {
    const a = "one\r\ntwo\r\n";
    const b = "one\ntwo\n";
    expect(unifiedDiff(a, b)).toBe("");
  });
});
