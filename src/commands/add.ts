import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import {
  readConfig,
  resolveTargetPath,
  fileExists,
  type FancyConfig,
} from "../config.js";
import { fetchItem, type RegistryItem } from "../registry.js";
import {
  detectPackageManager,
  runInstall,
  installCommand,
} from "../pm.js";
import { CliError } from "../errors.js";
import { bold, green, yellow, dim, cyan, red } from "../colors.js";

export interface AddFlags {
  overwrite?: boolean;
  install?: boolean; // false => --no-install
}

interface AddResult {
  filesWritten: string[];
  filesSkipped: string[];
  registryDepsPulled: string[];
  npmDeps: string[];
}

/**
 * Recursively resolve and write a registry item and all of its
 * registryDependencies. Mutates the shared sets/result.
 */
async function resolveItem(
  name: string,
  config: FancyConfig,
  flags: AddFlags,
  cwd: string,
  visited: Set<string>,
  npmDeps: Set<string>,
  result: AddResult,
  isRoot: boolean,
): Promise<void> {
  if (visited.has(name)) return;
  visited.add(name);

  const item: RegistryItem = await fetchItem(config.registry, name);
  if (!isRoot) {
    result.registryDepsPulled.push(name);
  }

  for (const file of item.files) {
    const dest = resolveTargetPath(config, file.target, cwd);
    const rel = path.relative(cwd, dest).replace(/\\/g, "/");
    if ((await fileExists(dest)) && !flags.overwrite) {
      result.filesSkipped.push(rel);
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.content, "utf8");
    result.filesWritten.push(rel);
  }

  for (const dep of item.dependencies) {
    npmDeps.add(dep);
  }

  for (const regDep of item.registryDependencies) {
    await resolveItem(
      regDep,
      config,
      flags,
      cwd,
      visited,
      npmDeps,
      result,
      false,
    );
  }
}

export async function add(
  names: string[],
  flags: AddFlags,
  cwd: string = process.cwd(),
): Promise<number> {
  if (names.length === 0) {
    throw new CliError(
      `No component name given.`,
      `Usage: fancy-ui add <name...>   e.g. fancy-ui add card`,
    );
  }

  const config = await readConfig(cwd);

  const visited = new Set<string>();
  const npmDeps = new Set<string>();
  const result: AddResult = {
    filesWritten: [],
    filesSkipped: [],
    registryDepsPulled: [],
    npmDeps: [],
  };

  for (const name of names) {
    await resolveItem(name, config, flags, cwd, visited, npmDeps, result, true);
  }

  result.npmDeps = [...npmDeps];

  // Print a clean summary.
  stdout.write("\n");
  if (result.filesWritten.length > 0) {
    stdout.write(bold(`Files written (${result.filesWritten.length})\n`));
    for (const f of result.filesWritten) {
      stdout.write(`  ${green("+")} ${f}\n`);
    }
  }
  if (result.filesSkipped.length > 0) {
    stdout.write(
      yellow(`\nSkipped ${result.filesSkipped.length} existing file(s)`) +
        dim(" (pass --overwrite to replace)\n"),
    );
    for (const f of result.filesSkipped) {
      stdout.write(`  ${yellow("=")} ${f}\n`);
    }
  }
  if (result.registryDepsPulled.length > 0) {
    stdout.write(
      `\n${bold("Registry dependencies pulled:")} ${result.registryDepsPulled
        .map((d) => cyan(d))
        .join(", ")}\n`,
    );
  }

  // Install npm dependencies.
  if (result.npmDeps.length > 0) {
    if (flags.install === false) {
      stdout.write(
        `\n${bold("npm dependencies needed")} ${dim("(install skipped — --no-install)")}\n`,
      );
      const pm = await detectPackageManager(cwd);
      stdout.write(`  ${dim("run:")} ${cyan(installCommand(pm, result.npmDeps))}\n`);
    } else {
      const pm = await detectPackageManager(cwd);
      stdout.write(
        `\n${bold("Installing dependencies")} ${dim(`(${pm})`)}: ${result.npmDeps
          .map((d) => cyan(d))
          .join(", ")}\n`,
      );
      try {
        await runInstall(pm, result.npmDeps, cwd);
        stdout.write(`${green("✓")} Dependencies installed.\n`);
      } catch (err) {
        stdout.write(
          `${red("✗")} Could not run ${pm}: ${(err as Error).message}\n` +
            dim(`  Install them manually: ${installCommand(pm, result.npmDeps)}\n`),
        );
      }
    }
  }

  if (
    result.filesWritten.length === 0 &&
    result.filesSkipped.length > 0 &&
    result.npmDeps.length === 0
  ) {
    stdout.write(
      dim(`\nNothing new written — everything was already vendored.\n`),
    );
  }

  stdout.write(`\n${green("Done.")}\n`);
  return 0;
}

// Exported for tests.
export const __test = { resolveItem };
