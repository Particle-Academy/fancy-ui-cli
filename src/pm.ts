import { spawn } from "node:child_process";
import path from "node:path";
import { fileExists } from "./config.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Detect the package manager from a lockfile in `cwd`. Defaults to npm. */
export async function detectPackageManager(
  cwd: string = process.cwd(),
): Promise<PackageManager> {
  if (await fileExists(path.join(cwd, "bun.lockb"))) return "bun";
  if (await fileExists(path.join(cwd, "bun.lock"))) return "bun";
  if (await fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(cwd, "yarn.lock"))) return "yarn";
  if (await fileExists(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

function installArgs(pm: PackageManager, deps: string[]): string[] {
  switch (pm) {
    case "yarn":
      return ["add", ...deps];
    case "bun":
      return ["add", ...deps];
    case "pnpm":
      return ["add", ...deps];
    case "npm":
    default:
      return ["install", ...deps];
  }
}

/** The shell command string we'd run, for printing in summaries/dry-runs. */
export function installCommand(pm: PackageManager, deps: string[]): string {
  return `${pm} ${installArgs(pm, deps).join(" ")}`;
}

/** Run the package manager to install `deps`. Resolves on success. */
export function runInstall(
  pm: PackageManager,
  deps: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = installArgs(pm, deps);
    const child = spawn(pm, args, {
      cwd,
      stdio: "inherit",
      // On Windows the package managers are .cmd shims; shell:true resolves them.
      shell: process.platform === "win32",
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${pm} exited with code ${code}`));
      }
    });
  });
}
