import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { add } from "../src/commands/add.js";
import { addNode } from "../src/commands/add-node.js";
import { writeConfig, type FancyConfig } from "../src/config.js";
import { CliError } from "../src/errors.js";
import {
  assertInstallableDependencies,
  isValidDependencyName,
  resolvePackageManager,
  runInstall,
  runManager,
} from "../src/pm.js";
import { items, mockFetch } from "./fixtures.js";

/**
 * Which program actually runs when the CLI asks for a package manager.
 *
 * Every fixture here is a harmless script that appends one line to a marker file
 * in the test's own temp directory, so "what ran" is read from the marker rather
 * than inferred from an exit code.
 *
 * cmd.exe skips the current directory when NoDefaultCurrentDirectoryInExePath is
 * set, so a developer shell with that variable would make these pass on code that
 * is wrong. Each test removes it and asserts that it is gone.
 */

const WIN = process.platform === "win32";
const NO_CWD_VAR = "NoDefaultCurrentDirectoryInExePath";
const SEMVER = /^\d+\.\d+\.\d+/;
const ENV_KEYS = ["PATH", NO_CWD_VAR, "PATHEXT", "SystemRoot", "ComSpec"];

let root: string;
let project: string;
let trusted: string;
let marker: string;
let savedEnv: Record<string, string | undefined>;

async function ranLines(): Promise<string[]> {
  const text = await readFile(marker, "utf8").catch(() => "");
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** A script named like a program, recording `label` and its arguments. */
async function fake(dir: string, name: string, label: string, ext = WIN ? ".cmd" : ""): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name + ext);
  if (WIN) {
    await writeFile(file, `@echo off\r\n>>"${marker}" echo ${label} %*\r\n`);
  } else {
    await writeFile(file, `#!/bin/sh\necho "${label} $*" >> "${marker}"\n`);
    await chmod(file, 0o755);
  }
  return file;
}

/** A manager shim that, like npm's own, runs `node` by bare name. */
async function fakeShimCallingBareNode(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (WIN) {
    await writeFile(path.join(dir, `${name}.cmd`), "@echo off\r\nnode --version\r\n");
  } else {
    const file = path.join(dir, name);
    await writeFile(file, "#!/bin/sh\nnode --version\n");
    await chmod(file, 0o755);
  }
}

const config: FancyConfig = {
  registry: "https://registry.test",
  aliases: { components: "@/components/fancy", utils: "@/lib/utils" },
  rsc: false,
  tsx: true,
  tailwind: { css: "src/index.css" },
  dirs: { components: "src/components/fancy" },
};

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env[NO_CWD_VAR];
  expect(
    Object.keys(process.env).filter((k) => k.toLowerCase() === NO_CWD_VAR.toLowerCase()),
  ).toEqual([]);

  root = await mkdtemp(path.join(tmpdir(), "fancy-pm-"));
  project = path.join(root, "project");
  trusted = path.join(root, "trusted");
  marker = path.join(root, "marker.txt");
  await mkdir(project, { recursive: true });
  await mkdir(trusted, { recursive: true });
  await writeConfig(config, project);
  mockFetch();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(root, { recursive: true, force: true });
});

describe("control: the fixture really can catch the defect", () => {
  it("runs a project-local plant when the name is resolved the old way", async () => {
    await fake(project, "npm", "PLANT");
    if (!WIN) process.env.PATH = `.:${process.env.PATH}`;

    // The exact shape the CLI used to spawn. If this stops planting, every test
    // below is passing for no reason.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["--version"], {
        cwd: project,
        shell: WIN,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", reject);
      child.on("close", () => resolve());
    });

    expect(await ranLines()).toEqual(["PLANT --version"]);
  }, 30_000);
});

describe("the real package manager runs, not one in the project", () => {
  it.each(WIN ? [".cmd", ".bat"] : [""])("ignores a planted npm%s in the working directory", async (ext) => {
    await fake(project, "npm", "PLANT", ext);
    if (!WIN) process.env.PATH = `.:${process.env.PATH}`;

    const out = await runManager("npm", ["--version"], project, { capture: true });

    expect(out.trim()).toMatch(SEMVER);
    expect(await ranLines()).toEqual([]);
  }, 30_000);

  it.runIf(WIN)("ignores a planted npm.exe in the working directory", async () => {
    // .EXE precedes .CMD in the default PATHEXT, so this one wins the old lookup.
    await copyFile(path.join(process.env.SystemRoot!, "System32", "hostname.exe"), path.join(project, "npm.exe"));

    const out = await runManager("npm", ["--version"], project, { capture: true });

    expect(out.trim()).toMatch(SEMVER);
  }, 30_000);

  it("ignores a plant reached through the project's own node_modules/.bin on PATH", async () => {
    // npx and npm run both prepend <project>/node_modules/.bin as an ABSOLUTE
    // entry, so "absolute only" is not enough on its own.
    const bin = path.join(project, "node_modules", ".bin");
    await fake(bin, "pnpm", "PLANT");
    await fake(trusted, "pnpm", "TRUSTED");
    process.env.PATH = [bin, trusted].join(path.delimiter);

    await runInstall("pnpm", ["clsx"], project);

    expect(await ranLines()).toEqual(["TRUSTED add clsx"]);
  });

  it("does not let the shim's own bare `node` reach a plant in the project", async () => {
    // npm's shim falls back to `node` by name when no node.exe sits beside it.
    await fakeShimCallingBareNode(trusted, "npm");
    await fake(project, "node", "PLANT");
    process.env.PATH = [".", trusted, path.dirname(process.execPath)].join(path.delimiter);

    const out = await runManager("npm", ["install"], project, { capture: true });

    expect(out.trim()).toBe(process.version);
    expect(await ranLines()).toEqual([]);
  });

  it.runIf(WIN)("runs an .exe manager directly", async () => {
    await copyFile(path.join(process.env.SystemRoot!, "System32", "hostname.exe"), path.join(trusted, "bun.exe"));
    process.env.PATH = trusted;

    const out = await runManager("bun", [], project, { capture: true });

    expect(out.trim().toLowerCase()).toBe(hostname().toLowerCase());
  });

  it.runIf(WIN)("does not take its shell from COMSPEC", async () => {
    await fake(trusted, "npm", "TRUSTED");
    process.env.PATH = trusted;
    process.env.ComSpec = path.join(project, "does-not-exist.exe");

    await runInstall("npm", ["clsx"], project);

    expect(await ranLines()).toEqual(["TRUSTED install clsx"]);
  });

  it.runIf(WIN)("fails closed when SystemRoot does not lead to a system cmd.exe", async () => {
    await fake(trusted, "npm", "TRUSTED");
    process.env.PATH = trusted;
    process.env.SystemRoot = "relative\\windows";

    await expect(runInstall("npm", ["clsx"], project)).rejects.toThrow(/cmd\.exe/);
    expect(await ranLines()).toEqual([]);
  });

  it("copes with metacharacters and spaces in the manager's own directory", async () => {
    const odd = path.join(root, "Pro gram & Files (x86) ^ 100!");
    await fake(odd, "npm", "TRUSTED");
    process.env.PATH = odd;

    await runInstall("npm", ["clsx", "@scope/pkg.name"], project);

    expect(await ranLines()).toEqual(["TRUSTED install clsx @scope/pkg.name"]);
  });
});

describe("resolvePackageManager", () => {
  const lookup = (entries: string[]): string | null =>
    resolvePackageManager("npm", project, { ...process.env, PATH: entries.join(path.delimiter) });

  it("takes the first absolute entry that has the program", async () => {
    const other = path.join(root, "other");
    const first = await fake(trusted, "npm", "A");
    await fake(other, "npm", "B");

    expect(lookup([trusted, other])).toBe(first);
  });

  /** A relative entry only means anything from where the CLI really runs. */
  function fromProject<T>(fn: () => T): T {
    const before = process.cwd();
    process.chdir(project);
    try {
      return fn();
    } finally {
      process.chdir(before);
    }
  }

  it("skips empty and relative entries", async () => {
    await fake(project, "npm", "PLANT");
    await fake(path.join(project, "bin"), "npm", "PLANT");
    // Relative, and outside the project: only the "absolute" rule can refuse it.
    await fake(trusted, "npm", "PLANT");

    for (const entry of ["", ".", "bin", path.join(".", "bin"), path.join("..", "project"), path.join("..", "trusted")]) {
      expect(fromProject(() => lookup([entry]))).toBeNull();
    }
  });

  it.runIf(WIN)("skips drive-relative and root-relative entries", async () => {
    await fake(project, "npm", "PLANT");
    const drive = project.slice(0, 2);

    for (const entry of [drive, project.slice(2)]) {
      expect(fromProject(() => lookup([entry]))).toBeNull();
    }
  });

  it("skips the project directory and anything inside it, however it is spelled", async () => {
    await fake(project, "npm", "PLANT");
    await fake(path.join(project, "tools"), "npm", "PLANT");

    expect(
      lookup([
        project,
        project + path.sep,
        path.join(project, "tools"),
        path.join(root, "trusted", "..", "project"),
        ...(WIN ? [project.toUpperCase()] : []),
      ]),
    ).toBeNull();
  });

  it("skips node_modules/.bin of a parent directory, which npx also puts on PATH", async () => {
    const parentBin = path.join(root, "node_modules", ".bin");
    await fake(parentBin, "npm", "PLANT");

    expect(lookup([parentBin])).toBeNull();
  });

  it("still searches a parent directory the user chose to put on PATH", async () => {
    const file = await fake(root, "npm", "A");

    expect(lookup([root])).toBe(file);
  });

  it.runIf(WIN)("strips the quotes Windows allows around a PATH entry", async () => {
    const file = await fake(trusted, "npm", "A");

    expect(lookup([`"${trusted}"`])).toBe(file);
  });

  it.runIf(WIN)("follows PATHEXT order, within one directory", async () => {
    await fake(trusted, "npm", "A", ".cmd");
    const bat = await fake(trusted, "npm", "B", ".bat");

    expect(
      resolvePackageManager("npm", project, { ...process.env, PATH: trusted, PATHEXT: ".BAT;.CMD" }),
    ).toBe(bat);
    expect(
      resolvePackageManager("npm", project, { ...process.env, PATH: trusted, PATHEXT: ".CMD;.BAT" }),
    ).toBe(path.join(trusted, "npm.cmd"));
  });

  it.runIf(WIN)("ignores an extensionless file and extensions it cannot run safely", async () => {
    await writeFile(path.join(trusted, "npm"), "#!/bin/sh\n");
    await writeFile(path.join(trusted, "npm.js"), "");
    await writeFile(path.join(trusted, "npm.ps1"), "");

    expect(
      resolvePackageManager("npm", project, { ...process.env, PATH: trusted, PATHEXT: ".JS;.PS1;.CMD" }),
    ).toBeNull();
  });

  it.runIf(WIN)("refuses a batch shim whose path cmd.exe would expand", async () => {
    const percent = path.join(root, "100%PATH%");
    await fake(percent, "npm", "A");

    expect(lookup([percent])).toBeNull();
  });

  it.runIf(!WIN)("requires the execute bit", async () => {
    const file = await fake(trusted, "npm", "A");
    await chmod(file, 0o644);

    expect(lookup([trusted])).toBeNull();
  });

  it("does not mistake a directory for the program", async () => {
    await mkdir(path.join(trusted, WIN ? "npm.cmd" : "npm"));

    expect(lookup([trusted])).toBeNull();
  });
});

const HOSTILE: unknown[] = [
  "a&echo PWNED",
  "a|echo PWNED",
  'a"&echo PWNED&"',
  "%PATH%",
  "a^b",
  "!PATH!",
  "a>b",
  "a<b",
  "a;b",
  "a b",
  "a\nb",
  "$(x)",
  "`x`",
  "(x)",
  "--prefix=x",
  "-g",
  "../evil",
  "./evil",
  "evil.tgz",
  "evil.tar",
  "evil.tar.gz",
  "git+https://registry.test/x.git",
  "https://registry.test/x.tgz",
  "file:x",
  "user/repo",
  ".hidden",
  "_private",
  "@scope",
  "@scope/",
  "@/x",
  "node_modules",
  "favicon.ico",
  "x".repeat(215),
  "",
  null,
  7,
];

describe("dependency names", () => {
  it.each([
    "clsx",
    "tailwind-merge",
    "lodash.merge",
    "under_score",
    "JSONStream",
    "@xyflow/react",
    "@particle-academy/react-fancy",
    "x".repeat(214),
  ])("accepts %s", (name) => {
    expect(isValidDependencyName(name)).toBe(true);
  });

  it.each(HOSTILE)("refuses %j, with no process started", async (name) => {
    await fake(trusted, "npm", "TRUSTED");
    process.env.PATH = trusted;

    const failure = await runInstall("npm", ["clsx", name as string], project).catch((e: unknown) => e);

    expect(await ranLines()).toEqual([]);
    expect(failure).toBeInstanceOf(CliError);
    expect(isValidDependencyName(name)).toBe(false);
  });

  it("names what it refused, escaped and cut short, and offers the rest", () => {
    let caught: unknown;
    try {
      assertInstallableDependencies("npm", ["clsx", `a\u001b[31m"&${"b".repeat(200)}`]);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CliError);
    const { message, hint } = caught as CliError;
    expect(message).not.toContain("\u001b");
    expect(message).toContain("\\u001b");
    expect(message.length).toBeLessThan(200);
    expect(hint).toContain("npm install clsx");
    expect(hint).not.toContain("&");
  });

  it("refuses an argument the shell could read, even past the name check", async () => {
    await fake(trusted, "npm", "TRUSTED");
    process.env.PATH = trusted;

    await expect(runManager("npm", ["a&b"], project)).rejects.toBeInstanceOf(CliError);
    expect(await ranLines()).toEqual([]);
  });
});

describe("a package manager that is not on PATH", () => {
  it("says so by name when a lockfile selected it", async () => {
    await writeFile(path.join(project, "yarn.lock"), "");
    await fake(trusted, "npm", "TRUSTED");
    process.env.PATH = trusted;

    const failure = await add(["card"], {}, project).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CliError);
    expect((failure as CliError).message).toMatch(/"yarn" was not found on PATH/);
    expect(await ranLines()).toEqual([]);
  });

  it("fails closed rather than running the copy in the project", async () => {
    await writeFile(path.join(project, "bun.lock"), "");
    await fake(project, "bun", "PLANT");
    process.env.PATH = trusted;

    await expect(add(["card"], {}, project)).rejects.toThrow(/"bun" was not found on PATH/);
    expect(await ranLines()).toEqual([]);
  });
});

describe("add, end to end", () => {
  it("installs through the project's own package manager", async () => {
    await writeFile(path.join(project, "pnpm-lock.yaml"), "");
    await fake(trusted, "pnpm", "TRUSTED");
    await fake(project, "pnpm", "PLANT");
    process.env.PATH = trusted;

    expect(await add(["card"], {}, project)).toBe(0);

    expect(await ranLines()).toEqual(["TRUSTED add clsx tailwind-merge"]);
  });

  describe("when the registry serves a dependency that is not a package name", () => {
    const BAD = 'clsx&echo PWNED>"x"';

    beforeEach(() => {
      items.hostile = { ...items.accordion!, name: "hostile", dependencies: ["lucide-react", BAD] };
    });

    afterEach(() => {
      delete items.hostile;
    });

    it("refuses the install", async () => {
      await fake(trusted, "npm", "TRUSTED");
      process.env.PATH = trusted;

      await expect(add(["hostile"], {}, project)).rejects.toBeInstanceOf(CliError);

      expect(await ranLines()).toEqual([]);
    });

    it("does not print it as a command to paste under --no-install", async () => {
      const out: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        out.push(String(chunk));
        return true;
      });

      const failure = await add(["hostile"], { install: false }, project).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(CliError);
      expect(out.join("")).not.toContain("npm install");
      expect((failure as CliError).hint).toContain("npm install lucide-react");
      expect((failure as CliError).hint).not.toContain("PWNED");
    });

    it("refuses it from a workflow node too", async () => {
      const manifest = {
        schemaVersion: 1,
        kind: "ui_effect",
        ui: ["ui"],
        runtimes: { ts: { files: ["js"], engine: ">=0.30.0" } },
        fixtures: "fixtures.json",
        verified: true,
        files: [{ target: "ui-effect/ui/kind.ts", content: "export {};\n" }],
        dependencies: ["clsx", BAD],
      };
      globalThis.fetch = (async (input: string | URL): Promise<Response> => {
        const url = String(input);
        const body = url.endsWith("/r/nodes/index.json")
          ? { items: [{ kind: "ui_effect", title: "Node", description: "", category: "io", runtimes: ["ts"], verified: true, url: "/r/nodes/ui_effect.json" }] }
          : manifest;
        return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
      }) as typeof fetch;
      await fake(trusted, "npm", "TRUSTED");
      process.env.PATH = trusted;

      const failure = await addNode(["ui_effect"], { backend: "none" }, project).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(CliError);
      expect(await ranLines()).toEqual([]);
    });
  });
});
