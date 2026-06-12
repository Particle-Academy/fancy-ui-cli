import { readFile } from "node:fs/promises";
import { stdout } from "node:process";
import path from "node:path";
import { readConfig, resolveTargetPath, fileExists } from "../config.js";
import { fetchItem } from "../registry.js";
import { unifiedDiff } from "../diff.js";
import { CliError } from "../errors.js";
import { bold, green, red, dim, cyan } from "../colors.js";

export interface DiffFlags {
  overwrite?: boolean; // unused; diff never writes
}

/** Colorize a unified-diff string for terminal output. */
function colorizeDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return bold(line);
      if (line.startsWith("@@")) return cyan(line);
      if (line.startsWith("+")) return green(line);
      if (line.startsWith("-")) return red(line);
      return line;
    })
    .join("\n");
}

export async function diff(
  name: string | undefined,
  cwd: string = process.cwd(),
): Promise<number> {
  if (!name || name.trim() === "") {
    throw new CliError(
      `No component name given.`,
      `Usage: fancy-ui diff <name>   e.g. fancy-ui diff card`,
    );
  }
  const config = await readConfig(cwd);
  const item = await fetchItem(config.registry, name.trim());

  let anyChange = false;
  let anyLocal = false;

  for (const file of item.files) {
    const dest = resolveTargetPath(config, file.target, cwd);
    const rel = path.relative(cwd, dest).replace(/\\/g, "/");
    if (!(await fileExists(dest))) {
      stdout.write(
        dim(`(not vendored) `) + `${rel}\n`,
      );
      continue;
    }
    anyLocal = true;
    const local = await readFile(dest, "utf8");
    const ud = unifiedDiff(local, file.content, {
      fromLabel: `${rel} (local)`,
      toLabel: `${rel} (registry)`,
    });
    if (ud === "") {
      continue;
    }
    anyChange = true;
    stdout.write(colorizeDiff(ud));
    stdout.write("\n");
  }

  if (!anyLocal) {
    throw new CliError(
      `No local copy of "${name}" found.`,
      `Vendor it first: fancy-ui add ${name}`,
    );
  }
  if (!anyChange) {
    stdout.write(green(`✓ "${name}" is up to date with the registry.\n`));
  }
  return 0;
}
