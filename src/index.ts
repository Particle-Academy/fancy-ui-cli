import { parseArgs } from "node:util";
import { stdout, stderr } from "node:process";
import { init } from "./commands/init.js";
import { add } from "./commands/add.js";
import { list } from "./commands/list.js";
import { search } from "./commands/search.js";
import { diff } from "./commands/diff.js";
import { addNode } from "./commands/add-node.js";
import { listNodes, searchNodes } from "./commands/nodes.js";
import { CliError } from "./errors.js";
import { bold, cyan, dim, red, yellow } from "./colors.js";

// Kept in sync with package.json by the build; hardcoded so we have zero
// runtime fs reads of package.json from inside the bundled dist.
const VERSION = "0.3.0";

const HELP = `${bold("fancy-cli")} ${dim(`v${VERSION}`)} — vendor Fancy UI component source from the registry.

${bold("Usage")}
  npx fancy-cli <command> [options]

${bold("Commands")}
  ${cyan("init")}                 Configure this project (writes ${bold("fancy.json")}).
  ${cyan("add <name...>")}        Fetch component(s) + their deps into your project.
  ${cyan("list")}                 List every registry component, grouped by package.
  ${cyan("search <query>")}       Substring search across name / title / description.
  ${cyan("diff <name>")}          Diff your local copy against the latest registry version.

${bold("Workflow nodes")} ${dim("— fancy-flow node packages")}
  ${cyan("add node <kind...>")}   Install node package(s), after checking they run on your runtimes.
  ${cyan("list nodes")}           List every published node, grouped by category.
  ${cyan("search nodes <query>")} Find a node by concept before you hand-roll one.

${bold("Options")}
  ${cyan("-h, --help")}           Show this help.
  ${cyan("-v, --version")}        Print the CLI version.

${bold("init options")}
  ${cyan("--yes")}                Accept all defaults non-interactively.
  ${cyan("--force")}              Overwrite an existing ${bold("fancy.json")}.

${bold("add options")}
  ${cyan("--overwrite")}          Overwrite files that already exist on disk.
  ${cyan("--no-install")}         Don't run the package manager to install deps.
  ${cyan("--force")}              ${dim("(add node)")} Install despite a runtime mismatch.
  ${cyan("--backend=php|js")}     ${dim("(add node)")} Which runtime executes the node. Detected from the
                        project when omitted. The UI is installed either way.

${bold("Examples")}
  npx fancy-cli init
  npx fancy-cli add card
  npx fancy-cli add card calendar accordion
  npx fancy-cli list
  npx fancy-cli search calendar
  npx fancy-cli diff card
  npx fancy-cli search nodes "route with an llm"
  npx fancy-cli add node @acme/salesforce_upsert

Docs: ${cyan("https://ui.particle.academy/docs/cli")}
`;

function printHelp(): void {
  stdout.write(HELP + "\n");
}

/**
 * Whether to run the package manager.
 *
 * Node's `parseArgs` does NOT negate `--no-install` into `install: false` — it
 * records a separate `no-install` key and leaves the default in place. So every
 * `--no-install` since this CLI shipped ran the package manager anyway, which
 * for a tool that shells out to npm is doing the opposite of what it was told.
 *
 * Exported so the behaviour is tested directly rather than re-derived in a
 * test, which would only ever assert that two copies of a bug agree.
 */
export function resolveInstallFlag(values: Record<string, unknown>): boolean {
  if (values["no-install"] === true) return false;
  return values.install !== false;
}

/**
 * `--backend=php|js`, or undefined to let `add node` detect it.
 *
 * A typo must not silently become "detect it for me" — the whole point of
 * passing the flag is that you did not want the guess. Common spellings for the
 * two ecosystems are accepted rather than lectured about; anything else is an
 * error naming what is valid.
 */
export function resolveBackendFlag(value: unknown): "php" | "js" | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const normalized = String(value).trim().toLowerCase();
  if (["php", "laravel", "composer"].includes(normalized)) return "php";
  if (["js", "ts", "node", "npm", "typescript", "javascript"].includes(normalized)) return "js";

  throw new CliError(
    `Unknown backend "${value}".`,
    `Use ${bold("--backend=php")} (Laravel / Composer) or ${bold("--backend=js")} (Node / npm), or omit it to detect from the project.`,
  );
}

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      yes: { type: "boolean" },
      force: { type: "boolean" },
      overwrite: { type: "boolean" },
      install: { type: "boolean", default: true },
      backend: { type: "string" },
    },
  });

  const command = positionals[0];
  const rest = positionals.slice(1);

  const install = resolveInstallFlag(values);

  // Top-level --version / --help (with or without a command).
  if (values.version && !command) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (!command || ((values.help as boolean | undefined) && !command)) {
    printHelp();
    return command ? 0 : 0;
  }

  switch (command) {
    case "help":
      printHelp();
      return 0;
    case "init":
      return init({
        yes: Boolean(values.yes),
        force: Boolean(values.force),
      });
    case "add":
      // `add node <kind>` is a workflow node package, not a component. The
      // subcommand rather than a flag because the two install entirely
      // different things: components vendor source files, nodes install
      // per-runtime packages after a compatibility check.
      if (rest[0] === "node" || rest[0] === "nodes") {
        return addNode(rest.slice(1), {
          install,
          force: Boolean(values.force),
          backend: resolveBackendFlag(values.backend),
        });
      }
      return add(rest, { overwrite: Boolean(values.overwrite), install });
    case "list":
      return rest[0] === "nodes" ? listNodes() : list();
    case "search":
      return rest[0] === "nodes" ? searchNodes(rest[1]) : search(rest[0]);
    case "diff":
      return diff(rest[0]);
    default:
      stderr.write(
        `${red(`Unknown command:`)} ${bold(String(command))}\n\n` +
          `Run ${cyan("fancy-cli --help")} to see available commands.\n`,
      );
      return 1;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  try {
    const code = await run(argv);
    process.exitCode = code;
  } catch (err) {
    if (err instanceof CliError) {
      stderr.write(`${red("Error:")} ${err.message}\n`);
      if (err.hint) {
        stderr.write(`${yellow("Hint:")} ${err.hint}\n`);
      }
    } else {
      stderr.write(`${red("Unexpected error:")} ${(err as Error).message}\n`);
      if (process.env.FANCY_DEBUG) {
        stderr.write(String((err as Error).stack) + "\n");
      }
    }
    process.exitCode = 1;
  }
}

// Only run when invoked as the process entry (the bin), not when imported by
// tests. tsup bundles everything into dist/index.js, so by the time this runs
// as a binary there is exactly one module and it IS the entry. Tests import
// `run` directly and set FANCY_NO_MAIN to keep main() from firing.
function shouldRunMain(): boolean {
  if (process.env.FANCY_NO_MAIN === "1") return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = new URL(`file://${entry.replace(/\\/g, "/")}`).href;
    // Match when our module URL ends with the entry path (handles .ts vs .js,
    // bin shims, and bundled dist).
    const here = import.meta.url;
    return (
      here === entryUrl ||
      here.endsWith("/index.js") ||
      here.endsWith("/index.ts") ||
      entry.endsWith("fancy-cli")
    );
  } catch {
    return false;
  }
}

if (shouldRunMain()) {
  void main();
}
