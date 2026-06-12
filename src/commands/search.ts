import { stdout } from "node:process";
import { fetchIndex, type RegistryIndexItem } from "../registry.js";
import { readConfig, DEFAULT_REGISTRY } from "../config.js";
import { CliError } from "../errors.js";
import { cyan, dim, pad, bold } from "../colors.js";

async function resolveRegistry(cwd: string): Promise<string> {
  try {
    return (await readConfig(cwd)).registry;
  } catch {
    return DEFAULT_REGISTRY;
  }
}

/** Case-insensitive substring match across name, title, description. */
export function filterItems(
  items: RegistryIndexItem[],
  query: string,
): RegistryIndexItem[] {
  const q = query.toLowerCase();
  return items.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q),
  );
}

export function renderMatches(matches: RegistryIndexItem[]): string {
  if (matches.length === 0) return "";
  const nameWidth = Math.max(4, ...matches.map((i) => i.name.length));
  const titleWidth = Math.max(5, ...matches.map((i) => i.title.length));
  return matches
    .map(
      (i) =>
        `${cyan(pad(i.name, nameWidth))}  ${pad(i.title, titleWidth)}  ${dim(i.description)}`,
    )
    .join("\n");
}

export async function search(
  query: string | undefined,
  cwd: string = process.cwd(),
): Promise<number> {
  if (!query || query.trim() === "") {
    throw new CliError(
      `No search query given.`,
      `Usage: fancy-cli search <query>   e.g. fancy-cli search calendar`,
    );
  }
  const registry = await resolveRegistry(cwd);
  const index = await fetchIndex(registry);
  const matches = filterItems(index.items, query.trim());
  matches.sort((a, b) => a.name.localeCompare(b.name));
  if (matches.length === 0) {
    stdout.write(dim(`No components match "${query}".\n`));
    return 0;
  }
  stdout.write(
    `${bold(`${matches.length} match${matches.length === 1 ? "" : "es"}`)} for "${query}"\n\n`,
  );
  stdout.write(renderMatches(matches) + "\n");
  return 0;
}
