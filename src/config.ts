import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";

export const DEFAULT_REGISTRY = "https://ui.particle.academy";
export const DEFAULT_COMPONENTS_DIR = "src/components/fancy";
export const DEFAULT_COMPONENTS_ALIAS = "@/components/fancy";
export const DEFAULT_UTILS_ALIAS = "@/lib/utils";
export const DEFAULT_CSS = "src/index.css";

export const CONFIG_FILENAME = "fancy.json";
export const SCHEMA_URL = "https://ui.particle.academy/schema/fancy.json";

/**
 * The on-disk `fancy.json` shape. Mirrors the documented config plus a
 * schema-additive `dirs.components` capturing the concrete directory where
 * component files land (so we never have to parse tsconfig path aliases).
 */
export interface FancyConfig {
  $schema?: string;
  registry: string;
  aliases: {
    components: string;
    utils: string;
  };
  rsc: boolean;
  tsx: boolean;
  tailwind: {
    css: string;
  };
  /** Where component files are written on disk. Schema-additive. */
  dirs?: {
    components: string;
  };
}

export function configPath(cwd: string = process.cwd()): string {
  return path.join(cwd, CONFIG_FILENAME);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function configExists(cwd: string = process.cwd()): Promise<boolean> {
  return fileExists(configPath(cwd));
}

/**
 * Resolve the concrete on-disk components directory for a config.
 * Prefers an explicit `dirs.components`; otherwise derives it deterministically
 * from `aliases.components` by replacing a leading `@/` with `src/`.
 */
export function resolveComponentsDir(config: FancyConfig): string {
  if (config.dirs?.components) {
    return config.dirs.components;
  }
  const alias = config.aliases.components;
  if (alias.startsWith("@/")) {
    return "src/" + alias.slice(2);
  }
  // Fallback: strip a leading "@" or just use the alias verbatim.
  return alias.replace(/^@\/?/, "");
}

/**
 * The registry `target` is always `components/fancy/{slug}/{file}`. We map the
 * `components/fancy/` prefix onto the user's configured components directory, so
 * the on-disk location is `{componentsDir}/{slug}/{file}`.
 */
export function resolveTargetPath(
  config: FancyConfig,
  target: string,
  cwd: string = process.cwd(),
): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = "components/fancy/";
  const rest = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
  const componentsDir = resolveComponentsDir(config);
  return path.join(cwd, componentsDir, rest);
}

export async function readConfig(cwd: string = process.cwd()): Promise<FancyConfig> {
  const p = configPath(cwd);
  if (!(await fileExists(p))) {
    throw new CliError(
      `No ${CONFIG_FILENAME} found in this project.`,
      `Run \`npx fancy-ui init\` first to configure the vendor flow.`,
    );
  }
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    throw new CliError(`Could not read ${CONFIG_FILENAME}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`${CONFIG_FILENAME} is not valid JSON.`);
  }
  return normalizeConfig(parsed);
}

function normalizeConfig(parsed: unknown): FancyConfig {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const aliases = (obj.aliases ?? {}) as Record<string, unknown>;
  const tailwind = (obj.tailwind ?? {}) as Record<string, unknown>;
  const dirs = (obj.dirs ?? {}) as Record<string, unknown>;

  const config: FancyConfig = {
    $schema: typeof obj.$schema === "string" ? obj.$schema : SCHEMA_URL,
    registry: typeof obj.registry === "string" ? obj.registry : DEFAULT_REGISTRY,
    aliases: {
      components:
        typeof aliases.components === "string"
          ? aliases.components
          : DEFAULT_COMPONENTS_ALIAS,
      utils:
        typeof aliases.utils === "string" ? aliases.utils : DEFAULT_UTILS_ALIAS,
    },
    rsc: typeof obj.rsc === "boolean" ? obj.rsc : false,
    tsx: typeof obj.tsx === "boolean" ? obj.tsx : true,
    tailwind: {
      css: typeof tailwind.css === "string" ? tailwind.css : DEFAULT_CSS,
    },
  };
  if (typeof dirs.components === "string") {
    config.dirs = { components: dirs.components };
  }
  return config;
}

export async function writeConfig(
  config: FancyConfig,
  cwd: string = process.cwd(),
): Promise<string> {
  const p = configPath(cwd);
  const ordered: FancyConfig = {
    $schema: config.$schema ?? SCHEMA_URL,
    registry: config.registry,
    aliases: config.aliases,
    rsc: config.rsc,
    tsx: config.tsx,
    tailwind: config.tailwind,
    ...(config.dirs ? { dirs: config.dirs } : {}),
  };
  await writeFile(p, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  return p;
}
