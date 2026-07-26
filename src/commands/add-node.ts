import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { fileExists, readConfig, resolveNodeTargetPath, rewritePhpNamespace } from "../config.js";
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
   * The UI is copied either way — see {@link plan}.
   */
  backend?: BackendId;
  /** Overwrite node files already on disk. */
  overwrite?: boolean;
}

/**
 * Where a node's logic runs — or `none` for the surface only.
 *
 * `none` is for a project that authors graphs and does not execute them: the
 * editor, the palette and the config panel, with no executor to maintain.
 */
export type BackendId = "php" | "js" | "none";

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
const RUNTIME_FOR: Record<BackendId, string> = { php: "php", js: "ts", none: "" };

/**
 * Which of a node's source directories to copy, given the chosen backend.
 *
 * A node is vendored, not installed: one source, copied into the project, the
 * same way components are. So this returns directory names — `ui`, `js`, `php`
 * — and the caller writes every file under them.
 *
 * ## Why `ui` comes down whichever backend you pick
 *
 * A node is a UI *and* a backend, and the UI is React on every host — a Laravel
 * app still renders the editor in a browser. Treating `ts` and `php` as two
 * interchangeable runtimes and copying one is how a Laravel project ends up
 * with a node it can execute and cannot see: files on disk, no palette entry,
 * no config panel, and nothing saying why.
 */
export function plan(
  manifest: NodeManifest,
  backend: BackendId,
): { parts: string[]; problem?: string } {
  const runtimes = manifest.runtimes ?? {};
  const ui = manifest.ui ?? [];

  // Asked for no backend, so a missing one is not a problem to report — it is
  // exactly what was requested. Warning here would be the tool arguing with an
  // explicit instruction.
  if (backend === "none") return { parts: [...ui] };

  const wanted = runtimes[RUNTIME_FOR[backend]];

  if (!wanted) {
    const has = Object.keys(runtimes).join(", ") || "none";
    return {
      // Still take the UI — a node you can see and cannot run is at least
      // legible, and the message below says exactly what is missing.
      parts: [...ui],
      problem:
        `This node has no ${backend} backend (it implements: ${has}). ` +
        `Copied anyway it would appear in the palette and fail at run time.`,
    };
  }

  // The surface, then this backend's source. Never another backend's: a Laravel
  // project has no use for the JS executor and would end up with two
  // implementations of a node it runs once.
  return { parts: [...new Set([...ui, ...(wanted.files ?? [])])] };
}

async function readJsonIfPresent(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
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

  const config = await readConfig(cwd);
  const registry = config.registry;
  const host = await detectHost(cwd);
  const composerJson = await readJsonIfPresent(path.join(cwd, "composer.json"));
  const backend = flags.backend ?? detectBackend(composerJson);
  const npmDeps: string[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
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
      // than a failed copy: it looks like it worked.
      stdout.write(
        `\n${red("Not added.")} Pass ${cyan("--force")} to copy it anyway ` +
          `${dim("(the node will appear in the palette and fail at run time)")}.\n`,
      );
      blocked = true;
      continue;
    }
    if (errors.length > 0 && flags.force) {
      stdout.write(`\n${yellow("Copying anyway (--force).")}\n`);
    }

    stdout.write(renderCapabilities(manifest) + renderPlanningFacts(manifest));

    const { parts, problem } = plan(manifest, backend);

    if (problem) {
      stdout.write(`\n${red("✗")} ${problem}\n`);
      if (!flags.force) {
        blocked = true;
        continue;
      }
    }

    // The node's source, copied in. Nothing is installed — a node lives in the
    // project the same way a vendored component does, so it can be read, edited
    // and diffed rather than hidden in node_modules or vendor.
    const wanted = new Set(parts);
    const files = manifest.files.filter((f) => wanted.has(partOf(f.target)));

    for (const file of files) {
      const dest = resolveNodeTargetPath(config, file.target, cwd);
      const rel = path.relative(cwd, dest).replace(/\\/g, "/");

      if ((await fileExists(dest)) && !flags.overwrite) {
        skipped.push(rel);
        continue;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      // PHP resolves a class by its namespace, so a vendored file has to be
      // told where it now lives — otherwise the file is in the app and the
      // class is not, and the error names a class nobody wrote.
      const content = dest.endsWith(".php") ? rewritePhpNamespace(file.content, config) : file.content;
      await writeFile(dest, content, "utf8");
      written.push(rel);
    }

    for (const dep of manifest.dependencies ?? []) npmDeps.push(dep);
  }

  if (written.length > 0) {
    stdout.write(`\n${bold("Added")}\n${written.map((f) => `  ${green("+")} ${f}`).join("\n")}\n`);
  }
  if (skipped.length > 0) {
    stdout.write(
      `\n${bold("Skipped")} ${dim("(already present — pass --overwrite)")}\n` +
        skipped.map((f) => `  ${yellow("•")} ${f}`).join("\n") +
        "\n",
    );
  }

  // A node's own npm dependencies — the libraries its source imports, NOT the
  // node itself. There is no package for the node.
  const uniqueNpm = [...new Set(npmDeps)];
  if (uniqueNpm.length > 0) {
    const pm = await detectPackageManager(cwd);
    if (flags.install !== false) {
      stdout.write(`\n${dim(`Installing dependencies: ${installCommand(pm, uniqueNpm)}`)}\n`);
      await runInstall(pm, uniqueNpm, cwd);
    } else {
      stdout.write(`\n${bold("Dependencies:")} ${cyan(installCommand(pm, uniqueNpm))}\n`);
    }
  }

  if (written.length === 0 && skipped.length === 0 && !blocked) {
    stdout.write(`\n${yellow("Nothing copied")} — the node published no files for this backend.\n`);
  }

  return blocked ? 1 : 0;
}

/** `ui-effect/php/Foo.php` → `php`. The directory that decides where it lands. */
function partOf(target: string): string {
  const segments = target.replace(/\\/g, "/").split("/").filter(Boolean);

  return segments[1] ?? "";
}

async function detectHost(cwd: string): Promise<HostRuntimes> {
  const [pkg, composer] = await Promise.all([
    readJsonIfPresent(path.join(cwd, "package.json")),
    readJsonIfPresent(path.join(cwd, "composer.json")),
  ]);
  return detectHostRuntimes(pkg, composer);
}
