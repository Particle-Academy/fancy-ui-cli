import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_COMPONENTS_ALIAS,
  DEFAULT_UTILS_ALIAS,
  DEFAULT_CSS,
  DEFAULT_REGISTRY,
  SCHEMA_URL,
  CONFIG_FILENAME,
  type FancyConfig,
  configExists,
  writeConfig,
} from "../config.js";
import { CliError } from "../errors.js";
import { bold, cyan, green, dim, gray } from "../colors.js";

export interface InitFlags {
  yes?: boolean;
  force?: boolean;
}

async function askDefault(
  rl: readline.Interface,
  question: string,
  fallback: string,
): Promise<string> {
  const answer = (await rl.question(`${question} ${gray(`(${fallback})`)} `)).trim();
  return answer === "" ? fallback : answer;
}

async function askYesNo(
  rl: readline.Interface,
  question: string,
  fallback: boolean,
): Promise<boolean> {
  const hint = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} ${gray(`(${hint})`)} `))
    .trim()
    .toLowerCase();
  if (answer === "") return fallback;
  return answer === "y" || answer === "yes";
}

/** Derive a components alias from a directory by mapping a leading `src/` to `@/`. */
function aliasFromDir(dir: string): string {
  const norm = dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (norm.startsWith("src/")) {
    return "@/" + norm.slice(4);
  }
  return DEFAULT_COMPONENTS_ALIAS;
}

export async function init(flags: InitFlags): Promise<number> {
  if ((await configExists()) && !flags.force) {
    throw new CliError(
      `${CONFIG_FILENAME} already exists.`,
      `Pass --force to overwrite it.`,
    );
  }

  let componentsDir = DEFAULT_COMPONENTS_DIR;
  let componentsAlias = DEFAULT_COMPONENTS_ALIAS;
  let css = DEFAULT_CSS;
  let autoInstall = true;

  if (!flags.yes) {
    stdout.write(bold("\nConfigure Fancy UI for this project\n"));
    stdout.write(dim("Press Enter to accept each default.\n\n"));
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      componentsDir = await askDefault(
        rl,
        "Where should component source live?",
        DEFAULT_COMPONENTS_DIR,
      );
      componentsAlias = await askDefault(
        rl,
        "Import alias for that directory?",
        aliasFromDir(componentsDir),
      );
      css = await askDefault(rl, "Tailwind CSS file?", DEFAULT_CSS);
      autoInstall = await askYesNo(rl, "Auto-install peer dependencies?", true);
    } finally {
      rl.close();
    }
  }

  const config: FancyConfig = {
    $schema: SCHEMA_URL,
    registry: DEFAULT_REGISTRY,
    aliases: {
      components: componentsAlias,
      utils: DEFAULT_UTILS_ALIAS,
    },
    rsc: false,
    tsx: true,
    tailwind: { css },
    dirs: { components: componentsDir },
  };

  // Persist whether the user opted out of auto-install via a sentinel? We keep
  // fancy.json matching the documented shape; auto-install preference is an
  // `add`-time flag (--no-install). For init --yes we always default to install.
  void autoInstall;

  const written = await writeConfig(config);
  stdout.write(
    `\n${green("✓")} Wrote ${bold(CONFIG_FILENAME)} ${dim(`(${written})`)}\n`,
  );
  stdout.write(
    `${dim("  components →")} ${cyan(componentsDir)}  ${dim("alias")} ${cyan(componentsAlias)}\n`,
  );
  stdout.write(
    `${dim("  registry   →")} ${cyan(DEFAULT_REGISTRY)}\n`,
  );
  stdout.write(
    `\nNext: ${cyan("npx fancy-ui add card")}\n`,
  );
  if (!autoInstall) {
    stdout.write(
      dim(`  (you chose to skip auto-install — pass --no-install to add, or run your installer yourself)\n`),
    );
  }
  return 0;
}
