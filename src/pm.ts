import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileExists } from "./config.js";
import { CliError } from "./errors.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

type Env = Record<string, string | undefined>;

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

/**
 * npm's package name rule, minus the legacy characters it still tolerates
 * (`~'!()*`), which no registry dependency needs.
 *
 * Bare names only. A range, a path, a URL or a `user/repo` shorthand is a
 * different kind of install from a dependency name, and the registry contract
 * has never needed one.
 */
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_NAME_LENGTH = 214;
const RESERVED_NAMES = new Set(["node_modules", "favicon.ico"]);
/** npm reads these as a local tarball even though they satisfy the name rule. */
const TARBALL_NAME = /[.](?:tgz|tar|tar[.]gz)$/i;

export function isValidDependencyName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= MAX_NAME_LENGTH &&
    PACKAGE_NAME.test(name) &&
    !RESERVED_NAMES.has(name.toLowerCase()) &&
    !TARBALL_NAME.test(name)
  );
}

function describeRefused(name: unknown): string {
  const text = JSON.stringify(typeof name === "string" && name.length > 40 ? `${name.slice(0, 40)}...` : name);
  return text ?? String(name);
}

/**
 * Refuse a dependency list holding anything but package names.
 *
 * The strings come from a registry response, so they are checked before they
 * are run, and before they are printed as a command someone might paste.
 */
export function assertInstallableDependencies(pm: PackageManager, deps: unknown[]): void {
  const refused = deps.filter((d) => !isValidDependencyName(d));
  if (refused.length === 0) return;

  const rest = deps.filter(isValidDependencyName);
  throw new CliError(
    `Refusing to install: the registry listed ${refused.length === 1 ? "a dependency that is" : "dependencies that are"} not a valid package name: ${refused.slice(0, 3).map(describeRefused).join(", ")}${refused.length > 3 ? ", ..." : ""}`,
    `Nothing was installed.${rest.length > 0 ? ` The valid ones can be installed with: ${installCommand(pm, rest)}` : ""}`,
  );
}

/** Keys are case-insensitive on Windows, and a copied env keeps their spelling. */
function envKeys(env: Env, name: string): string[] {
  if (process.platform !== "win32") return name in env ? [name] : [];
  const wanted = name.toLowerCase();
  return Object.keys(env).filter((k) => k.toLowerCase() === wanted);
}

function envValue(env: Env, name: string): string | undefined {
  const [key] = envKeys(env, name);
  return key === undefined ? undefined : env[key];
}

function isAbsoluteEntry(entry: string): boolean {
  if (process.platform !== "win32") return path.isAbsolute(entry);
  // Not path.isAbsolute: on win32 that accepts `\tools`, which depends on the
  // current drive.
  return /^[A-Za-z]:[\\/]/.test(entry) || /^\\\\[^\\]/.test(entry);
}

/** A path in the form it can be compared in: symlinks, case and 8.3 names settled. */
function canonical(p: string): string {
  let real: string;
  try {
    real = realpathSync.native(p);
  } catch {
    real = path.resolve(p);
  }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel);
}

/**
 * The PATH entries we are willing to run a program from: absolute, and not part
 * of the project.
 *
 * "Absolute" alone is not enough. `npx` and `npm run` prepend
 * `<project>/node_modules/.bin` and the same for every parent directory, all as
 * absolute paths, so a repository can place a program on PATH just by committing
 * it there.
 */
function trustedPathEntries(cwd: string, env: Env): string[] {
  const project = canonical(cwd);
  return (envValue(env, "PATH") ?? "")
    .split(path.delimiter)
    .map((entry) => (process.platform === "win32" ? entry.trim().replace(/^"(.*)"$/, "$1") : entry))
    .filter((entry) => {
      if (!isAbsoluteEntry(entry)) return false;
      const dir = canonical(entry);
      if (isWithin(project, dir)) return false;
      const owner = path.dirname(path.dirname(dir));
      const isBinDir = path.basename(dir) === ".bin" && path.basename(path.dirname(dir)) === "node_modules";
      return !(isBinDir && isWithin(owner, project));
    });
}

function isBatch(file: string): boolean {
  return /[.](?:cmd|bat)$/i.test(file);
}

/** The PATHEXT kinds that can be run without handing a file association the choice. */
const RUNNABLE_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"];

function windowsExtensions(env: Env): string[] {
  const listed = (envValue(env, "PATHEXT") ?? "")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => RUNNABLE_EXTENSIONS.includes(ext));
  return listed.length > 0 ? listed : RUNNABLE_EXTENSIONS;
}

function isRunnableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform !== "win32") accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a package manager on PATH, as an absolute path, or null.
 *
 * Never the working directory: on Windows `cmd.exe` searches that first, and the
 * working directory is the user's project, which may simply have been cloned.
 */
export function resolvePackageManager(
  pm: PackageManager,
  cwd: string = process.cwd(),
  env: Env = process.env,
): string | null {
  const candidates = process.platform === "win32" ? windowsExtensions(env).map((ext) => pm + ext) : [pm];
  for (const dir of trustedPathEntries(cwd, env)) {
    for (const name of candidates) {
      const file = path.join(dir, name);
      // `%` is expanded by cmd.exe even inside quotes, so a batch file under such
      // a directory cannot be named on its command line.
      if (isBatch(file) && /[%"\r\n]/.test(file)) continue;
      if (isRunnableFile(file)) return file;
    }
  }
  return null;
}

/** `%SystemRoot%\System32\cmd.exe`, never COMSPEC and never a bare `cmd`. */
function systemCmd(env: Env): string | null {
  const root = envValue(env, "SystemRoot");
  if (!root || !isAbsoluteEntry(root)) return null;
  const file = path.join(root, "System32", "cmd.exe");
  return isRunnableFile(file) ? file : null;
}

/**
 * The environment a manager runs in.
 *
 * Resolving the manager is not the end of it, because its shim then runs other
 * programs: npm's and yarn's `.cmd` shims both fall back to `node` by bare name,
 * and cmd.exe would find that in the project too. NoDefaultCurrentDirectoryInExePath
 * turns that search off, and PATH loses the entries we refused to search ourselves.
 */
function childEnv(cwd: string, cmd: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const trusted = trustedPathEntries(cwd, env).join(path.delimiter);

  for (const key of envKeys(env, "PATH")) delete env[key];
  env.PATH = trusted;

  if (process.platform === "win32") {
    for (const key of envKeys(env, "NoDefaultCurrentDirectoryInExePath")) delete env[key];
    env.NoDefaultCurrentDirectoryInExePath = "1";
    if (cmd) {
      // A shim's `FOR /F` starts its inner shell from this variable.
      for (const key of envKeys(env, "ComSpec")) delete env[key];
      env.ComSpec = cmd;
    }
  }
  return env;
}

/** Everything that reaches a command line: nothing cmd.exe gives a meaning to. */
const SAFE_ARGUMENT = /^[A-Za-z0-9@/._-]+$/;

/**
 * Run a package manager found by {@link resolvePackageManager}.
 *
 * On Windows a manager is usually a `.cmd` shim, which Node will not spawn
 * without a shell (CVE-2024-27980). It goes through the system cmd.exe with its
 * own path quoted and every argument limited to {@link SAFE_ARGUMENT}, so there
 * is nothing to escape: a batch file re-parses `%*`, which is why quoting the
 * arguments would not be enough. The shim is run rather than unpacked because
 * npm, pnpm, yarn, corepack and version managers each write a different one, and
 * none of them promises its layout.
 *
 * `capture` returns stdout instead of inheriting it, for tests.
 */
export async function runManager(
  pm: PackageManager,
  args: string[],
  cwd: string = process.cwd(),
  options: { capture?: boolean } = {},
): Promise<string> {
  if (!args.every((arg) => SAFE_ARGUMENT.test(arg))) {
    throw new CliError(`Refusing to run ${pm}: an argument contains characters that are not safe on a command line.`);
  }

  const resolved = resolvePackageManager(pm, cwd);
  if (!resolved) {
    throw new CliError(
      `Package manager "${pm}" was not found on PATH.`,
      `Install ${pm} and run this again; a lockfile in the project decides which manager is used. Relative PATH entries and directories inside the project are not searched.`,
    );
  }

  const win = process.platform === "win32";
  const cmd = win ? systemCmd(process.env) : null;
  if (win && isBatch(resolved) && !cmd) {
    throw new CliError(
      `Cannot run ${pm}: ${resolved} needs cmd.exe, and SystemRoot does not lead to one.`,
      `Set SystemRoot to your Windows directory. COMSPEC is deliberately not used.`,
    );
  }

  const viaCmd = win && isBatch(resolved);
  const file = viaCmd ? (cmd as string) : resolved;
  const argv = viaCmd
    ? ["/d", "/v:off", "/s", "/c", `""${resolved}" ${args.join(" ")}"`]
    : args;

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, {
      cwd,
      env: childEnv(cwd, cmd),
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: viaCmd,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`${pm} exited with code ${code}`));
      }
    });
  });
}

/** Run the package manager to install `deps`. Resolves on success. */
export async function runInstall(
  pm: PackageManager,
  deps: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  assertInstallableDependencies(pm, deps);
  await runManager(pm, installArgs(pm, deps), cwd);
}
