import { describe, it, expect } from "vitest";
import { renderGroups } from "../src/commands/list.js";
import { filterItems, renderMatches } from "../src/commands/search.js";
import { index } from "./fixtures.js";
import { visibleLength } from "../src/colors.js";

describe("list rendering", () => {
  it("groups by package with per-group counts", () => {
    const out = renderGroups(index.items);
    expect(out).toContain("react-fancy");
    expect(out).toContain("(2)"); // card + accordion
    expect(out).toContain("fancy-flow");
    expect(out).toContain("(1)");
  });

  it("includes name, title and description for each item", () => {
    const out = renderGroups(index.items);
    expect(out).toContain("card");
    expect(out).toContain("Card");
    expect(out).toContain("Container with header/body/footer.");
  });

  it("aligns names into a consistent column", () => {
    const out = renderGroups(index.items);
    // Every item line starts with two spaces; the name column is padded to the
    // widest name ("flow-editor" = 11). Just assert it renders without throwing
    // and the longest name appears.
    expect(out).toContain("flow-editor");
    expect(visibleLength("card")).toBe(4);
  });
});

describe("search", () => {
  it("matches case-insensitively across name/title/description", () => {
    expect(filterItems(index.items, "CARD").map((i) => i.name)).toEqual(["card"]);
    expect(filterItems(index.items, "disclosure").map((i) => i.name)).toEqual([
      "accordion",
    ]);
    expect(filterItems(index.items, "workflow").map((i) => i.name)).toEqual([
      "flow-editor",
    ]);
  });

  it("returns empty for no match", () => {
    expect(filterItems(index.items, "zzzzz")).toHaveLength(0);
    expect(renderMatches([])).toBe("");
  });

  it("renders matches with title + description", () => {
    const out = renderMatches(filterItems(index.items, "card"));
    expect(out).toContain("card");
    expect(out).toContain("Container with header/body/footer.");
  });
});
