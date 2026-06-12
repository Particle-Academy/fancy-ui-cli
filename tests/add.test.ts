import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockFetch } from "./fixtures.js";
import { add } from "../src/commands/add.js";
import { writeConfig, type FancyConfig } from "../src/config.js";

let dir: string;

const config: FancyConfig = {
  registry: "https://registry.test",
  aliases: { components: "@/components/fancy", utils: "@/lib/utils" },
  rsc: false,
  tsx: true,
  tailwind: { css: "src/index.css" },
  dirs: { components: "src/components/fancy" },
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fancy-add-"));
  await writeConfig(config, dir);
  mockFetch();
  // Silence stdout writes from the command.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function compDir(...parts: string[]): string {
  return path.join(dir, "src/components/fancy", ...parts);
}

describe("add", () => {
  it("writes component files to the resolved on-disk path", async () => {
    const code = await add(["card"], { install: false }, dir);
    expect(code).toBe(0);
    const card = await readFile(compDir("card", "Card.tsx"), "utf8");
    expect(card).toContain("export const Card");
    const idx = await readFile(compDir("card", "index.ts"), "utf8");
    expect(idx).toContain("export * from './Card'");
  });

  it("recursively resolves registryDependencies", async () => {
    await add(["card"], { install: false }, dir);
    // card -> cn-util, whose file should also land.
    const cn = await readFile(compDir("lib", "cn.ts"), "utf8");
    expect(cn).toContain("export function cn");
  });

  it("dedupes npm dependencies across the bundle and surfaces them", async () => {
    // card deps: clsx, tailwind-merge ; cn-util deps: clsx (dup)
    const calls: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      calls.push(String(chunk));
      return true;
    });
    await add(["card"], { install: false }, dir);
    const out = calls.join("");
    // clsx appears once in the install command, tailwind-merge once.
    const installLine = out.split("\n").find((l) => l.includes("clsx")) ?? "";
    const clsxCount = (installLine.match(/clsx/g) ?? []).length;
    expect(clsxCount).toBe(1);
    expect(out).toContain("tailwind-merge");
  });

  it("never overwrites an existing file without --overwrite", async () => {
    await mkdir(compDir("card"), { recursive: true });
    await writeFile(compDir("card", "Card.tsx"), "// MY EDITS\n", "utf8");
    await add(["card"], { install: false }, dir);
    const card = await readFile(compDir("card", "Card.tsx"), "utf8");
    expect(card).toBe("// MY EDITS\n");
  });

  it("overwrites when --overwrite is passed", async () => {
    await mkdir(compDir("card"), { recursive: true });
    await writeFile(compDir("card", "Card.tsx"), "// MY EDITS\n", "utf8");
    await add(["card"], { install: false, overwrite: true }, dir);
    const card = await readFile(compDir("card", "Card.tsx"), "utf8");
    expect(card).toContain("export const Card");
  });

  it("errors with a helpful message when no fancy.json exists", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "fancy-empty-"));
    try {
      await expect(add(["card"], { install: false }, empty)).rejects.toThrow(
        /No fancy\.json/i,
      );
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("errors on an unknown component (404 / error body)", async () => {
    await expect(add(["nope"], { install: false }, dir)).rejects.toThrow(
      /not found/i,
    );
  });

  it("dedupes a component requested twice", async () => {
    const code = await add(["card", "card"], { install: false }, dir);
    expect(code).toBe(0);
  });
});
