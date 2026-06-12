import { parseArgs } from "node:util";
import { stdout, stderr } from "node:process";
import { init } from "./commands/init.js";
import { add } from "./commands/add.js";
import { list } from "./commands/list.js";
import { search } from "./commands/search.js";
import { diff } from "./commands/diff.js";
import { CliError } from "./errors.js";
import { bold, cyan, dim, red, yellow } from "./colors.js";

// Kept in sync with package.json by the build; hardcoded so we have zero
// runtime fs reads of package.json from inside the bundled dist.
const VERSION = "0.1.0";

const HELP = `${bold("fancy-ui")} ${dim(`v${VERSION}`)} — vendor Fancy UI component source from the registry.

${bold("Usage")}
  npx fancy-ui <command> [options]

${bold("Commands")}
  ${cyan("init")}                 Configure this project (writes ${bold("fancy.json")}).
  ${cyan("add <name...>")}        Fetch component(s) + their deps into your project.
  ${cyan("list")}                 List every registry component, grouped by package.
  ${cyan("search <query>")}       Substring search across name / title / description.
  ${cyan("diff <name>")}          Diff your local copy against the latest registry version.

${bold("Options")}
  ${cyan("-h, --help")}           Show this help.
  ${cyan("-v, --version")}        Print the CLI version.

${bold("init options")}
  ${cyan("--yes")}                Accept all defaults non-interactively.
  ${cyan("--force")}              Overwrite an existing ${bold("fancy.json")}.

${bold("add options")}
  ${cyan("--overwrite")}          Overwrite files that already exist on disk.
  ${cyan("--no-install")}         Don't run the package manager to install deps.

${bold("Examples")}
  npx fancy-ui init
  npx fancy-ui add card
  npx fancy-ui add card calendar accordion
  npx fancy-ui list
  npx fancy-ui search calendar
  npx fancy-ui diff card

Docs: ${cyan("https://ui.particle.academy/docs/cli")}
`;

function printHelp(): void {
  stdout.write(HELP + "\n");
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
    },
  });

  const command = positionals[0];
  const rest = positionals.slice(1);

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
      return add(rest, {
        overwrite: Boolean(values.overwrite),
        install: values.install !== false,
      });
    case "list":
      return list();
    case "search":
      return search(rest[0]);
    case "diff":
      return diff(rest[0]);
    default:
      stderr.write(
        `${red(`Unknown command:`)} ${bold(String(command))}\n\n` +
          `Run ${cyan("fancy-ui --help")} to see available commands.\n`,
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
      entry.endsWith("fancy-ui")
    );
  } catch {
    return false;
  }
}

if (shouldRunMain()) {
  void main();
}
