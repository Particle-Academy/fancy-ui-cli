import { readFile } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { readConfig, DEFAULT_REGISTRY } from "../config.js";
import {
  fetchNode,
  detectHostRuntimes,
  checkNodeCompat,
  type NodeManifest,
  type HostRuntimes,
} from "../nodes.js";
import { detectPackageManager, runInstall, installCommand } from "../pm.js";
import { CliError } from "../errors.js";
import { bold, green, yellow, dim, cyan, red } from "../colors.js";

export interface AddNodeFlags {
  install?: boolean;
  /** Install despite an incompatibility. Prints what is being overridden. */
  force?: boolean;
  /**
   * Which runtime executes the node. Omit to detect it from the project.
   *
   * The UI is installed either way — see {@link plan}.
   */
  backend?: BackendId;
}

/** The runtimes a node's logic can run on. */
export type BackendId = "php" | "js";

/**
 * Detect the backend from the project.
 *
 * A `composer.json` means PHP executes here, and that wins: an Inertia app has
 * BOTH manifests, and in that pairing PHP is the one running the workflow while
 * npm is only carrying the editor.
 */
export function detectBackend(composerJson: unknown): BackendId {
  return composerJson ? "php" : "js";
}

/** The runtime id a backend maps to in a manifest's `runtimes`. */
const RUNTIME_FOR: Record<BackendId, string> = { php: "php", js: "ts" };

/**
 * What to install for one node, given the chosen backend.
 *
 * ## Why the npm package is installed either way
 *
 * A node is a UI *and* a backend, and the UI is React on every host — a Laravel
 * app still renders the editor in the browser. Treating `ts` and `php` as two
 * interchangeable runtimes and picking one is how a Laravel project ends up
 * with a node it can execute and cannot see: installed, no palette entry, no
 * config panel. So the npm package comes down for the surface whenever the node
 * publishes one, and the backend choice decides what runs the graph.
 */
export function plan(
  manifest: NodeManifest,
  backend: BackendId,
): { npm: string[]; composer: string[]; problem?: string } {
  const npm: string[] = [];
  const composer: string[] = [];
  const runtimes = manifest.runtimes ?? {};

  // The surface. `ts` is the npm side of a node, which carries the kind
  // definition whichever runtime executes it.
  const ui = runtimes.ts;
  if (ui) npm.push(ui.package ?? manifest.name);

  const wanted = runtimes[RUNTIME_FOR[backend]];
  if (!wanted) {
    const has = Object.keys(runtimes).join(", ") || "none";
    return {
      npm,
      composer,
      problem:
        `This node has no ${backend} backend (it implements: ${has}). ` +
        `Installed anyway it would appear in the palette and fail at run time.`,
    };
  }

  if (backend === "php") {
    // A PHP backend is a Composer requirement, which this CLI never runs for
    // you — a PHP project's dependency resolution is not a JS CLI's to trigger.
    composer.push(wanted.package ?? manifest.name);
  }

  return { npm, composer };
}

async function readJsonIfPresent(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function resolveRegistry(cwd: string): Promise<string> {
  try {
    return (await readConfig(cwd)).registry;
  } catch {
    return DEFAULT_REGISTRY;
  }
}

/** What a consumer has to wire before this node can run. */
function renderCapabilities(manifest: NodeManifest): string {
  const caps = Object.entries(manifest.capabilities ?? {});
  if (caps.length === 0) return "";

  const lines = caps.map(([id, level]) =>
    level === "required"
      ? `  ${red("required")}  ${bold(id)}`
      : `  ${dim("optional")}  ${bold(id)}`,
  );

  return (
    `\n${bold("Host capabilities")} ${dim("— wire these before the node can run")}\n` +
    lines.join("\n") +
    "\n"
  );
}

/**
 * Facts a host needs BEFORE running a graph, surfaced at install rather than
 * discovered from a run's behaviour.
 *
 * `pausesForHuman` matters because a parent that embeds workflows must reject a
 * child that can pause — otherwise the parent wedges. `sideEffects` matters
 * because durable runs RETRY, and a node that writes is not safe to replay.
 */
function renderPlanningFacts(manifest: NodeManifest): string {
  const lines: string[] = [];

  if (manifest.pausesForHuman) {
    lines.push(
      `  ${yellow("pauses")}    waits for a human (${bold(manifest.pausesForHuman)}) — needs a resume path, ` +
        `and cannot be embedded in a workflow that must run unattended.`,
    );
  }
  if (manifest.sideEffects === "unsafe-to-replay") {
    lines.push(
      `  ${yellow("replay")}    ${bold("unsafe to replay")} — durable runs retry, so guard this node ` +
        `or scope its retry policy.`,
    );
  }

  return lines.length ? `\n${bold("Before you run it")}\n${lines.join("\n")}\n` : "";
}

export function renderCompat(problems: ReturnType<typeof checkNodeCompat>): string {
  if (problems.length === 0) return "";
  return (
    problems
      .map((p) =>
        p.level === "error" ? `${red("✗")} ${p.message}` : `${yellow("!")} ${p.message}`,
      )
      .join("\n") + "\n"
  );
}

/**
 * Install a workflow node package.
 *
 * The check that earns this command's existence happens BEFORE any install: a
 * node that does not implement a runtime this project executes on would
 * install, appear in the palette, and then fail at run time. That is invisible
 * without a manifest, and it is the failure the whole marketplace contract
 * exists to prevent — so it is an error here, not a warning.
 */
export async function addNode(
  kinds: string[],
  flags: AddNodeFlags = {},
  cwd: string = process.cwd(),
): Promise<number> {
  if (kinds.length === 0) {
    throw new CliError(
      `No node given.`,
      `Usage: fancy-cli add node <kind>   e.g. fancy-cli add node @acme/salesforce_upsert`,
    );
  }

  const registry = await resolveRegistry(cwd);
  const host = await detectHost(cwd);
  const composerJson = await readJsonIfPresent(path.join(cwd, "composer.json"));
  const backend = flags.backend ?? detectBackend(composerJson);
  const npmDeps: string[] = [];
  const composerDeps: string[] = [];
  let blocked = false;

  stdout.write(
    `\n${bold("Backend")} ${cyan(backend)}` +
      (flags.backend
        ? ""
        : dim(` (detected from ${composerJson ? "composer.json" : "package.json"} — override with --backend)`)) +
      "\n",
  );

  for (const kind of kinds) {
    const manifest = await fetchNode(registry, kind);
    const problems = checkNodeCompat(manifest, host);
    const errors = problems.filter((p) => p.level === "error");

    stdout.write(
      `\n${bold(manifest.kind)} ${dim(manifest.name)}` +
        (manifest.verified ? ` ${green("verified")}` : "") +
        (manifest.description ? `\n${dim(manifest.description)}` : "") +
        "\n",
    );

    if (problems.length > 0) stdout.write("\n" + renderCompat(problems));

    if (errors.length > 0 && !flags.force) {
      // Refuse rather than warn. A palette entry that cannot execute is worse
      // than a failed install: it looks like it worked.
      stdout.write(
        `\n${red("Not installed.")} Pass ${cyan("--force")} to install anyway ` +
          `${dim("(the node will appear in the palette and fail at run time)")}.\n`,
      );
      blocked = true;
      continue;
    }
    if (errors.length > 0 && flags.force) {
      stdout.write(`\n${yellow("Installing anyway (--force).")}\n`);
    }

    stdout.write(renderCapabilities(manifest) + renderPlanningFacts(manifest));

    const parts = plan(manifest, backend);

    if (parts.problem) {
      stdout.write(`\n${red("✗")} ${parts.problem}\n`);
      if (!flags.force) {
        blocked = true;
        continue;
      }
    }

    npmDeps.push(...parts.npm);
    composerDeps.push(...parts.composer);
  }

  const uniqueNpm = [...new Set(npmDeps)];
  const uniqueComposer = [...new Set(composerDeps)];

  // Printed BEFORE the install runs. A failing npm install would otherwise
  // swallow the half of the instructions the CLI cannot carry out itself,
  // leaving a half-installed node and no record of what was still owed.
  if (uniqueComposer.length > 0) {
    // Never run composer on the user's behalf — a PHP project's dependency
    // resolution is not ours to trigger from a JS CLI.
    stdout.write(
      `\n${bold("For the PHP runtime, run this yourself:")}\n  ${cyan(`composer require ${uniqueComposer.join(" ")}`)}\n`,
    );
  }

  if (uniqueNpm.length > 0) {
    const pm = await detectPackageManager(cwd);
    if (flags.install !== false) {
      stdout.write(`\n${dim(`Installing: ${installCommand(pm, uniqueNpm)}`)}\n`);
      await runInstall(pm, uniqueNpm, cwd);
    } else {
      stdout.write(`\n${bold("Install:")} ${cyan(installCommand(pm, uniqueNpm))}\n`);
    }
  }

  if (uniqueNpm.length === 0 && uniqueComposer.length === 0 && !blocked) {
    stdout.write(`\n${yellow("Nothing to install")} — no runtime matched this project.\n`);
  }

  return blocked ? 1 : 0;
}

async function detectHost(cwd: string): Promise<HostRuntimes> {
  const [pkg, composer] = await Promise.all([
    readJsonIfPresent(path.join(cwd, "package.json")),
    readJsonIfPresent(path.join(cwd, "composer.json")),
  ]);
  return detectHostRuntimes(pkg, composer);
}
