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
  /** Where vendored files are written on disk. Schema-additive. */
  dirs?: {
    components: string;
    /**
     * Where a workflow node's TypeScript (its UI + JS backend) lands.
     * Defaults to `{components}/flow-nodes`.
     */
    flowNodes?: string;
    /**
     * Where a workflow node's PHP backend lands. Defaults to `app/Flow/Nodes`,
     * the PSR-4 root a Laravel app already autoloads.
     */
    flowNodesPhp?: string;
  };
}

/**
 * Where a node's vendored files go.
 *
 * Nodes are copied in, like components — so the two halves land in the two
 * places a project actually keeps them: TypeScript beside the other Fancy
 * components, PHP under `app/`. One node, one source, two destinations, because
 * no project puts React and PHP in the same directory.
 */
export function resolveNodeDirs(config: FancyConfig): { ts: string; php: string } {
  return {
    ts: config.dirs?.flowNodes ?? path.join(resolveComponentsDir(config), "flow-nodes"),
    php: config.dirs?.flowNodesPhp ?? path.join("app", "Flow", "Nodes"),
  };
}

/**
 * Rewrite a vendored PHP file's namespace to match where it now lives.
 *
 * A node's source declares `FancyFlow\Nodes\<Node>`, which is correct in the
 * marketplace repo and wrong the moment the file is copied into an app — PHP
 * resolves a class by its namespace, and PSR-4 maps the app's own root. Left
 * alone, every vendored PHP node is unautoloadable: the file is there, the class
 * is not, and the error names a class nobody wrote.
 *
 * So the namespace is rewritten the same way the TypeScript side rewrites the
 * `components/fancy/` prefix onto the configured directory. `dirs.flowNodesPhp`
 * decides the root: `app/Flow/Nodes` → `App\Flow\Nodes`, following Laravel's
 * own PSR-4 convention of the capitalised path.
 */
export function rewritePhpNamespace(content: string, config: FancyConfig): string {
  const root = resolveNodeDirs(config)
    .php.replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("\\");

  // Both the declaration and any `use` of a sibling in the same node — a node's
  // executor imports its own GitHost, and a half-rewritten file is worse than
  // an unrewritten one because it fails further from the cause.
  return content
    .replace(/^namespace\s+FancyFlow\\Nodes\\/gm, `namespace ${root}\\`)
    .replace(/^use\s+FancyFlow\\Nodes\\/gm, `use ${root}\\`);
}

/** `git-pr-open` → `GitPrOpen`. The node dir's PSR-4 spelling. */
export function pascalCase(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Resolve one node file's on-disk path.
 *
 * `target` arrives from the registry as `<node>/<part>/<file>` — e.g.
 * `ui-effect/php/UiEffectExecutor.php`. The part decides which root it lands
 * under; the rest of the path is preserved so a node's own layout survives the
 * copy.
 *
 * ## PHP lands on its PSR-4 path, not the registry's
 *
 * PHP is the exception, and it has to be. {@link rewritePhpNamespace} rewrites
 * `FancyFlow\Nodes\GitPrOpen` to `App\Flow\Nodes\GitPrOpen` — PascalCase, no
 * `php` segment, because that is what the source declares. Copying the registry
 * path verbatim put that class at `app/Flow/Nodes/git-pr-open/php/`, which PSR-4
 * cannot autoload: it expects `app/Flow/Nodes/GitPrOpen/`.
 *
 * The result installed cleanly, looked right in the file list, and then the
 * class simply did not exist at runtime. Reported by the Moic Suite integration,
 * who hand-patched it per node.
 *
 * So for PHP the node segment is PascalCased and the `php` part is dropped, and
 * the path agrees with the namespace by construction.
 */
export function resolveNodeTargetPath(
  config: FancyConfig,
  target: string,
  cwd: string = process.cwd(),
): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  const dirs = resolveNodeDirs(config);
  const segments = normalized.split("/").filter(Boolean);
  const isPhp = segments.includes("php");

  if (!isPhp) {
    return path.join(cwd, dirs.ts, normalized);
  }

  // A malformed target with no node segment falls back to the registry path
  // rather than throwing — a bad entry should not stop the other files landing.
  const node = segments[0];
  if (node === undefined) {
    return path.join(cwd, dirs.php, normalized);
  }

  return path.join(cwd, dirs.php, pascalCase(node), ...segments.slice(2));
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
      `Run \`npx fancy-cli init\` first to configure the vendor flow.`,
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
