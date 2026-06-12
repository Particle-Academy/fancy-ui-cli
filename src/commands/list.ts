import { stdout } from "node:process";
import { fetchIndex, type RegistryIndexItem } from "../registry.js";
import { readConfig } from "../config.js";
import { DEFAULT_REGISTRY } from "../config.js";
import { bold, cyan, dim, pad } from "../colors.js";

async function resolveRegistry(cwd: string): Promise<string> {
  try {
    const config = await readConfig(cwd);
    return config.registry;
  } catch {
    // list/search work without a fancy.json — fall back to the default registry.
    return DEFAULT_REGISTRY;
  }
}

/** Render grouped registry items to a string (testable). */
export function renderGroups(items: RegistryIndexItem[]): string {
  const groups = new Map<string, RegistryIndexItem[]>();
  for (const item of items) {
    const pkg = item.package || "(ungrouped)";
    const arr = groups.get(pkg);
    if (arr) arr.push(item);
    else groups.set(pkg, [item]);
  }

  // Column widths across the whole index for consistent alignment.
  const nameWidth = Math.max(4, ...items.map((i) => i.name.length));
  const titleWidth = Math.max(5, ...items.map((i) => i.title.length));

  const lines: string[] = [];
  const sortedPkgs = [...groups.keys()].sort();
  for (const pkg of sortedPkgs) {
    const arr = groups.get(pkg)!;
    arr.sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`${bold(pkg)} ${dim(`(${arr.length})`)}`);
    for (const item of arr) {
      lines.push(
        `  ${cyan(pad(item.name, nameWidth))}  ${pad(item.title, titleWidth)}  ${dim(item.description)}`,
      );
    }
  }
  return lines.join("\n");
}

export async function list(cwd: string = process.cwd()): Promise<number> {
  const registry = await resolveRegistry(cwd);
  const index = await fetchIndex(registry);
  stdout.write(renderGroups(index.items) + "\n");
  return 0;
}
