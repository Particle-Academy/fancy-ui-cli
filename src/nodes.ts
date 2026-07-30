import { CliError } from "./errors.js";

/**
 * Node registry client + host-compatibility checks.
 *
 * A workflow node is not one artifact: it is a kind definition plus an executor
 * for EACH runtime the consumer runs. A package shipping only a TS executor is
 * unusable to anyone executing on PHP, and without a check that stays invisible
 * until a run fails.
 *
 * ## What this checks, and what it does NOT
 *
 * The registry is the publish gate: it runs the node's golden fixtures on every
 * runtime the package claims and validates the manifest before listing it. So
 * this does not re-validate the manifest's shape — a listed node has already
 * passed that, and duplicating it here would only produce a second opinion to
 * disagree with.
 *
 * What the CLI can check that the registry cannot is HOST-SPECIFIC: does *this*
 * project execute on a runtime the node implements, at a version its range
 * allows. That answer depends on the machine the command runs on, so it has to
 * happen here.
 *
 * ## On the duplicated semver check
 *
 * `satisfiesRange` below is a third implementation of the same small subset —
 * fancy-flow (TS) and fancy-flow-php each have one. Importing fancy-flow's
 * would make a zero-dependency vendoring CLI pull in a workflow engine, which
 * is a worse trade than 40 duplicated lines.
 *
 * The three are kept honest by an IDENTICAL case table in each repo's tests.
 * If you change behaviour here, change it in all three and update that table,
 * or a package accepted by one runtime's tooling gets rejected by another's —
 * which is worse than having no check at all.
 */

/** How one runtime provides a node, and which engine version it needs. */
export interface NodeRuntimeSpec {
  /**
   * The node source directories this runtime needs, relative to the node.
   *
   * A node is vendored, not installed — `fancy-cli add node` copies these into
   * the project the way it copies a component. `ts` claims `ui` + `js`, `php`
   * claims `php`.
   */
  files?: string[];
  /** Semver range of THIS runtime's engine. */
  engine: string;
}

/** One vendored file: where it came from, where it goes, what is in it. */
export interface NodeFile {
  /** `<node>/<part>/<file>` — e.g. `ui-effect/php/UiEffectExecutor.php`. */
  target: string;
  content: string;
}

/** A Fancy suite package a node needs. Unversioned by contract. */
export interface FancyDependency {
  /** Suite slug — what `/packages/<slug>` documents. */
  package: string;
  npm?: string;
  composer?: string;
  /** Why the node needs it, printed alongside the install command. */
  reason?: string;
  requirement?: "required" | "optional";
}

export interface NodeManifest {
  schemaVersion: number;
  /** The marketplace source this node came from. Nothing is installed from it. */
  name: string;
  kind: string;
  aliases?: string[];
  configVersion?: number;
  /**
   * The node's SURFACE — its React kind — copied whichever backend you pick.
   *
   * Separate from `runtimes` on purpose. The editor is React on every host, so
   * a Laravel project needs these files and does NOT need the JS executor. Fold
   * the two together and a PHP host either loses its palette entry or gains a
   * second implementation of the node it will never run.
   */
  ui?: string[];
  runtimes: Record<string, NodeRuntimeSpec>;
  capabilities?: Record<string, "required" | "optional">;
  /**
   * Fancy suite packages the node's source imports.
   *
   * Kept apart from `dependencies` because the suite is polyglot and
   * vendorable: the same capability ships on npm, on Composer, and as source
   * you copy in, and which route a consumer wants depends on the host. Never
   * versioned — see the manifest contract in fancy-flow.
   */
  fancyDependencies?: FancyDependency[];
  fixtures: string;
  /**
   * The node's source, served by the registry and written into the project.
   *
   * A node is vendored, not installed — the files ARE the node, the same way a
   * component's files are the component.
   */
  files: NodeFile[];
  /** npm packages the node's own source imports. NOT the node itself. */
  dependencies?: string[];
  pausesForHuman?: string;
  sideEffects?: "none" | "idempotent" | "unsafe-to-replay";
  description?: string;
  /** Assigned by the registry, never by the package. */
  verified?: boolean;
}

export interface NodeIndexItem {
  kind: string;
  name: string;
  title: string;
  description: string;
  category: string;
  /** Runtime ids this node implements — what `add node` checks against. */
  runtimes: string[];
  verified: boolean;
  url: string;
}

export interface NodeIndex {
  $schema?: string;
  items: NodeIndexItem[];
}

export interface CompatProblem {
  level: "error" | "warning";
  message: string;
}

function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

async function fetchJson<T>(url: string, notFoundMsg?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new CliError(`Network error fetching ${url}`, (err as Error).message);
  }
  if (res.status === 404) throw new CliError(notFoundMsg ?? `Not found: ${url} (404).`);
  if (!res.ok) throw new CliError(`Registry returned ${res.status} ${res.statusText} for ${url}.`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CliError(`Registry returned non-JSON from ${url}.`);
  }
  if (body && typeof body === "object" && "error" in (body as object)) {
    throw new CliError(notFoundMsg ?? `Registry error: ${String((body as { error: unknown }).error)}`);
  }
  return body as T;
}

export async function fetchNodeIndex(registry: string): Promise<NodeIndex> {
  const url = joinUrl(registry, "/r/nodes/index.json");
  const index = await fetchJson<NodeIndex>(url);
  if (!index || !Array.isArray(index.items)) {
    throw new CliError(`Node index at ${url} is malformed (missing "items").`);
  }
  return index;
}

/**
 * Fetch a node's manifest, resolving its location THROUGH the index.
 *
 * A kind id contains a slash (`@acme/route_llm`), so building a path from it
 * means percent-encoding a path separator — and `%2F` is handled
 * inconsistently by static hosts, CDNs, and proxies, which is a bad thing to
 * depend on for every install. The index already carries a `url` per item, so
 * the registry decides its own layout and the CLI just follows it.
 *
 * The extra request buys the "did you mean" below, which a direct fetch could
 * not offer: a 404 on a constructed path knows nothing about what does exist.
 */
export async function fetchNode(registry: string, kind: string): Promise<NodeManifest> {
  const index = await fetchNodeIndex(registry);
  const item =
    index.items.find((i) => i.kind === kind) ??
    // A bare name is what someone types when they have seen the node in a
    // palette rather than a manifest.
    index.items.find((i) => i.kind.split("/").pop() === kind);

  if (!item) {
    throw new CliError(
      `Node "${kind}" is not in the registry.`,
      suggest(kind, index.items.map((i) => i.kind)),
    );
  }

  return fetchJson<NodeManifest>(joinUrl(registry, item.url));
}

/**
 * Nearest known kinds, by edit distance on the bare name.
 *
 * Substring matching was the first cut and it is the wrong tool: the dominant
 * reason someone lands here is a TYPO, and `route_lm` is not a substring of
 * `route_llm` in either direction. Edit distance catches exactly that case.
 */
function suggest(kind: string, known: string[]): string {
  const bare = (kind.split("/").pop() ?? kind).toLowerCase();

  const near = known
    .map((k) => ({ k, d: editDistance(bare, (k.split("/").pop() ?? k).toLowerCase()) }))
    // Scale the tolerance with the name — a fixed threshold is too loose for
    // short names and too strict for long ones.
    .filter(({ k, d }) => d <= Math.max(2, Math.floor(k.length / 4)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ k }) => k);

  return near.length > 0
    ? `Did you mean: ${near.join(", ")}?`
    : `Run "fancy-cli list nodes" to see what is available.`;
}

/** Levenshtein, two-row. Small enough not to warrant a dependency. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Typed as a dense number[] and indexed through locals, because
  // `noUncheckedIndexedAccess` types every read as `number | undefined` — and
  // an arithmetic expression full of `!` is harder to read than three names.
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (row[j - 1] ?? 0) + 1;
      const insertion = (prev[j] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      row[j] = Math.min(deletion, insertion, substitution);
    }
    prev = row;
  }

  return prev[b.length] ?? 0;
}

/**
 * Which runtimes this project executes workflows on, and at what versions.
 *
 * Detected rather than configured, because a wrong answer here produces a
 * confident check against a runtime the project does not use. Absent evidence
 * we report nothing and the caller warns, rather than assuming "ts".
 */
export interface HostRuntimes {
  runtimes: string[];
  versions: Record<string, string>;
}

/**
 * Read the project's engine versions from its lockfile-adjacent manifests.
 *
 * `package.json` names the TS engine; `composer.json` names the PHP one. A
 * project with both — which is exactly the split this whole mechanism exists
 * for — reports both.
 */
export function detectHostRuntimes(
  packageJson: unknown,
  composerJson: unknown,
): HostRuntimes {
  const runtimes: string[] = [];
  const versions: Record<string, string> = {};

  const tsVersion = depVersion(packageJson, "@particle-academy/fancy-flow");
  if (tsVersion) {
    runtimes.push("ts");
    const cleaned = cleanRange(tsVersion);
    if (cleaned) versions.ts = cleaned;
  }

  const phpVersion = depVersion(composerJson, "particle-academy/fancy-flow-php");
  if (phpVersion) {
    runtimes.push("php");
    const cleaned = cleanRange(phpVersion);
    if (cleaned) versions.php = cleaned;
  }

  return { runtimes, versions };
}

function depVersion(manifest: unknown, name: string): string | undefined {
  if (!manifest || typeof manifest !== "object") return undefined;
  const m = manifest as Record<string, Record<string, string> | undefined>;
  return m.dependencies?.[name] ?? m.require?.[name] ?? m.devDependencies?.[name];
}

/** `^0.16.0` / `~0.16` / `>=0.16.0` → `0.16.0`, so it can be range-tested. */
function cleanRange(spec: string): string | undefined {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(spec);
  return m ? `${m[1]}.${m[2]}.${m[3] ?? 0}` : undefined;
}

/**
 * Check a node against the runtimes this project executes on.
 *
 * A runtime the node does not implement is an ERROR: the node would install,
 * appear in the palette, and then fail to run — which is the exact experience
 * this check exists to prevent.
 *
 * An engine version outside the node's range is also an error. An unknown host
 * version is a WARNING rather than silence, because "we did not check" and "it
 * is fine" must not look the same.
 */
/**
 * The newest node manifest schema this CLI understands.
 *
 * Bump when a manifest field is added that a node genuinely cannot work without
 * — NOT for additive fields an older CLI can safely ignore.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Refuse a node whose manifest is newer than this CLI.
 *
 * `schemaVersion` was on the manifest type from the start and **never read**.
 * Combined with `npx` caching by package name — and with every install string
 * we published saying `npx fancy-cli add …` rather than `@latest` — a developer
 * could be running a CLI from months ago, meet a node using a field it has
 * never heard of, and get a *partial* install: the parts it understood, silently,
 * with no error. That surfaces later as "the node is in my palette but it does
 * not run", with nothing pointing at the cause.
 *
 * A manifest with NO `schemaVersion` is treated as v1, which is what every node
 * published before this check shipped is.
 */
export function checkSchemaVersion(manifest: NodeManifest): CompatProblem[] {
  const declared = manifest.schemaVersion ?? 1;

  if (!Number.isFinite(declared) || declared <= SUPPORTED_SCHEMA_VERSION) {
    return [];
  }

  return [
    {
      level: "error",
      message:
        `${manifest.kind} declares manifest schema v${declared}, but this fancy-cli understands up to v${SUPPORTED_SCHEMA_VERSION}. ` +
        `Installing it here would copy only the parts this version recognises and silently drop the rest. ` +
        `Run it with \`npx fancy-cli@latest\` — plain \`npx fancy-cli\` can reuse a cached older copy.`,
    },
  ];
}

export function checkNodeCompat(manifest: NodeManifest, host: HostRuntimes): CompatProblem[] {
  const problems: CompatProblem[] = [...checkSchemaVersion(manifest)];
  const provided = Object.keys(manifest.runtimes ?? {});

  if (host.runtimes.length === 0) {
    // Appended, NOT returned fresh — a literal array here would discard the
    // schema-version error above, and "we cannot tell your runtime" would hide
    // "this CLI is too old to install this node at all", which is the more
    // fundamental of the two and the one with an action attached.
    problems.push({
      level: "warning",
      message:
        `Could not tell which runtime this project executes workflows on ` +
        `(no @particle-academy/fancy-flow in package.json, no particle-academy/fancy-flow-php in composer.json). ` +
        `${manifest.kind} implements ${provided.join(", ") || "no runtime"} — check that against your setup.`,
    });

    return problems;
  }

  const missing = host.runtimes.filter((r) => !provided.includes(r));
  if (missing.length > 0) {
    problems.push({
      level: "error",
      message:
        `${manifest.kind} implements ${provided.join(", ") || "no runtime"}, but this project executes on ${missing.join(", ")}. ` +
        `It would install, appear in the palette, and then fail to run.`,
    });
  }

  for (const runtime of host.runtimes) {
    const spec = manifest.runtimes?.[runtime];
    if (!spec) continue;

    const hostVersion = host.versions[runtime];
    if (!hostVersion) {
      problems.push({
        level: "warning",
        message: `${manifest.kind} needs ${runtime} engine ${spec.engine}; this project's ${runtime} version could not be read, so the range was not checked.`,
      });
      continue;
    }

    if (!satisfiesRange(hostVersion, spec.engine)) {
      problems.push({
        level: "error",
        message: `${manifest.kind} needs ${runtime} engine ${spec.engine}, but this project has ${hostVersion}.`,
      });
    }
  }

  return problems;
}

/**
 * Minimal semver range check — `^x.y.z`, `~x.y.z`, `>=x.y.z`, `x.y.z`, `*`, `||`.
 *
 * Anything unparseable is treated as UNSATISFIED rather than passed, so a
 * malformed range fails loudly instead of waving a node through.
 *
 * MIRRORED in fancy-flow and fancy-flow-php. See the module note above before
 * changing it.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;

  const v = parseVersion(version);
  if (!v) return false;

  return trimmed.split("||").some((clause) => satisfiesClause(v, clause.trim()));
}

function satisfiesClause(v: [number, number, number], clause: string): boolean {
  const m = /^(\^|~|>=|>|<=|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(clause);
  if (!m) return false;

  const op = m[1] ?? "=";
  const target: [number, number, number] = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  const cmp = compare(v, target);

  switch (op) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    case "~":
      return cmp >= 0 && v[0] === target[0] && v[1] === target[1];
    case "^":
      // Below 1.0.0 a minor bump is breaking, so ^0.5 means 0.5.x — the range
      // every pre-1.0 package in this suite actually needs.
      if (target[0] === 0) return cmp >= 0 && v[0] === 0 && v[1] === target[1];
      return cmp >= 0 && v[0] === target[0];
    default:
      return false;
  }
}

function parseVersion(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}
