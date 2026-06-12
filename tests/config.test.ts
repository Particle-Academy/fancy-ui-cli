import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { init } from "../src/commands/init.js";
import {
  readConfig,
  resolveComponentsDir,
  resolveTargetPath,
  configExists,
  type FancyConfig,
} from "../src/config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fancy-init-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  // init reads/writes relative to process.cwd(); point cwd at the temp dir.
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("init --yes", () => {
  it("writes a valid fancy.json with documented defaults", async () => {
    const code = await init({ yes: true });
    expect(code).toBe(0);
    const raw = await readFile(path.join(dir, "fancy.json"), "utf8");
    const json = JSON.parse(raw);
    expect(json.$schema).toBe("https://ui.particle.academy/schema/fancy.json");
    expect(json.registry).toBe("https://ui.particle.academy");
    expect(json.aliases.components).toBe("@/components/fancy");
    expect(json.aliases.utils).toBe("@/lib/utils");
    expect(json.rsc).toBe(false);
    expect(json.tsx).toBe(true);
    expect(json.tailwind.css).toBe("src/index.css");
    expect(json.dirs.components).toBe("src/components/fancy");
  });

  it("round-trips through readConfig", async () => {
    await init({ yes: true });
    const config = await readConfig(dir);
    expect(config.registry).toBe("https://ui.particle.academy");
    expect(resolveComponentsDir(config)).toBe("src/components/fancy");
  });

  it("refuses to clobber an existing fancy.json without --force", async () => {
    await init({ yes: true });
    await expect(init({ yes: true })).rejects.toThrow(/already exists/i);
  });

  it("overwrites with --force", async () => {
    await init({ yes: true });
    const code = await init({ yes: true, force: true });
    expect(code).toBe(0);
    expect(await configExists(dir)).toBe(true);
  });
});

describe("path resolution", () => {
  const config: FancyConfig = {
    registry: "https://x",
    aliases: { components: "@/components/fancy", utils: "@/lib/utils" },
    rsc: false,
    tsx: true,
    tailwind: { css: "src/index.css" },
    dirs: { components: "src/components/fancy" },
  };

  it("maps a registry target onto the configured components dir", () => {
    const p = resolveTargetPath(
      config,
      "components/fancy/card/Card.tsx",
      "/proj",
    );
    expect(p.replace(/\\/g, "/")).toBe(
      "/proj/src/components/fancy/card/Card.tsx",
    );
  });

  it("derives the components dir from the alias when dirs is absent", () => {
    const c2: FancyConfig = { ...config, dirs: undefined };
    expect(resolveComponentsDir(c2)).toBe("src/components/fancy");
  });
});
