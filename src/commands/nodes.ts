import { stdout } from "node:process";
import { readConfig, DEFAULT_REGISTRY } from "../config.js";
import { fetchNodeIndex, type NodeIndexItem } from "../nodes.js";
import { CliError } from "../errors.js";
import { bold, cyan, dim, green, pad } from "../colors.js";

async function resolveRegistry(cwd: string): Promise<string> {
  try {
    return (await readConfig(cwd)).registry;
  } catch {
    return DEFAULT_REGISTRY;
  }
}

/**
 * Case-insensitive substring match across kind, title, description, category.
 *
 * Category is in the match set because the useful query is often a concept
 * rather than a name — "ai", "logic" — and the failure this whole surface
 * exists to prevent is "didn't know it existed and wrote a bespoke one",
 * not "couldn't install".
 */
export function filterNodes(items: NodeIndexItem[], query: string): NodeIndexItem[] {
  const q = query.toLowerCase();
  return items.filter(
    (i) =>
      i.kind.toLowerCase().includes(q) ||
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q),
  );
}

export function renderNodes(items: NodeIndexItem[]): string {
  if (items.length === 0) return "";

  const kindWidth = Math.max(4, ...items.map((i) => i.kind.length));
  const titleWidth = Math.max(5, ...items.map((i) => i.title.length));

  return items
    .map((i) => {
      // Runtimes are shown on every row on purpose: a node that implements only
      // one is unusable to half the audience, and that must be visible while
      // browsing rather than discovered at install.
      const runtimes = dim(`[${i.runtimes.join(" ")}]`);
      const mark = i.verified ? green("✓") : " ";
      return `${mark} ${cyan(pad(i.kind, kindWidth))}  ${pad(i.title, titleWidth)}  ${runtimes}  ${dim(i.description)}`;
    })
    .join("\n");
}

export async function listNodes(cwd: string = process.cwd()): Promise<number> {
  const registry = await resolveRegistry(cwd);
  const index = await fetchNodeIndex(registry);

  if (index.items.length === 0) {
    stdout.write(`${dim("No nodes published yet.")}\n`);
    return 0;
  }

  const byCategory = new Map<string, NodeIndexItem[]>();
  for (const item of index.items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  for (const [category, items] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    stdout.write(`\n${bold(category)}\n${renderNodes(items)}\n`);
  }

  stdout.write(
    `\n${dim(`${index.items.length} node(s). ${green("✓")} = verified. Install with`)} ${cyan("npx fancy-cli@latest add node <kind>")}\n`,
  );
  return 0;
}

export async function searchNodes(
  query: string | undefined,
  cwd: string = process.cwd(),
): Promise<number> {
  if (!query || query.trim() === "") {
    throw new CliError(
      `No search query given.`,
      `Usage: fancy-cli search nodes <query>   e.g. fancy-cli search nodes "route with an llm"`,
    );
  }

  const registry = await resolveRegistry(cwd);
  const index = await fetchNodeIndex(registry);
  const matches = filterNodes(index.items, query);

  if (matches.length === 0) {
    stdout.write(`${dim(`No nodes matched`)} ${bold(query)}.\n`);
    return 0;
  }

  stdout.write(renderNodes(matches) + "\n");
  return 0;
}
