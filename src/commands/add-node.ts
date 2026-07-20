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
  const npmDeps: string[] = [];
  const composerDeps: string[] = [];
  let blocked = false;

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

    for (const [runtime, spec] of Object.entries(manifest.runtimes ?? {})) {
      if (!host.runtimes.includes(runtime)) continue;
      if (runtime === "php" && spec.package) composerDeps.push(spec.package);
      else if (spec.package) npmDeps.push(spec.package);
      else npmDeps.push(manifest.name);
    }
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
