import { stderr } from "node:process";
import { bold, dim, yellow } from "./colors.js";

/**
 * Tell the user when the CLI they are running is not the CLI we publish.
 *
 * ## Why this exists
 *
 * Node *content* needs no CLI update — `add node` reads the live registry, so a
 * newly published node reaches everyone immediately. CLI *features* are the
 * opposite: the runtime-compatibility check, `--back-end`, and every future
 * manifest capability live in this binary.
 *
 * And `npx fancy-cli …` happily reuses whatever it cached the first time. A
 * developer who ran it once a year ago keeps running that copy, silently, and
 * we had no way to tell them — every install string we published said
 * `npx fancy-cli add …` rather than `npx fancy-cli@latest add …`, so the stale
 * copy was what most people had.
 *
 * ## Deliberately toothless
 *
 * This NEVER blocks, never prompts, and never delays the command it precedes:
 * the fetch is capped, failures are swallowed whole, and the result is a single
 * line on stderr so it cannot corrupt piped stdout. A version check that can
 * break the tool is worse than no version check.
 */
const REGISTRY_URL = "https://registry.npmjs.org/fancy-cli/latest";
const TIMEOUT_MS = 1500;

/** `1.2.3` -> `[1,2,3]`; anything unparseable sorts as `[0,0,0]`. */
function parts(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** True when `latest` is strictly newer than `current`. */
export function isOlder(current: string, latest: string): boolean {
  // Destructured rather than indexed in a loop: under `noUncheckedIndexedAccess`
  // a tuple index is `number | undefined`, and comparing those silently coerces.
  const [aMajor, aMinor, aPatch] = parts(current);
  const [bMajor, bMinor, bPatch] = parts(latest);

  if (bMajor !== aMajor) return bMajor > aMajor;
  if (bMinor !== aMinor) return bMinor > aMinor;

  return bPatch > aPatch;
}

/** The published `latest` version, or null if we could not find out. */
export async function fetchLatest(url: string = REGISTRY_URL): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;

    const body: unknown = await res.json();
    const version = (body as { version?: unknown } | null)?.version;

    return typeof version === "string" ? version : null;
  } catch {
    // Offline, blocked registry, proxy, timeout — all fine. Say nothing.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Print an upgrade hint if one is warranted. Returns what was printed (or null),
 * so this is testable without capturing streams.
 *
 * `FANCY_CLI_NO_UPDATE_CHECK=1` opts out entirely — CI logs do not need it, and
 * a tool that phones home with no off switch is a tool people stop trusting.
 */
export async function warnIfOutdated(
  current: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: () => Promise<string | null> = () => fetchLatest(),
): Promise<string | null> {
  if (env.FANCY_CLI_NO_UPDATE_CHECK) return null;

  const latest = await fetcher();
  if (latest === null || !isOlder(current, latest)) return null;

  const message =
    `${yellow("!")} fancy-cli ${current} is out of date — ${bold(latest)} is available.\n` +
    `  ${dim("npx caches by name, so plain `npx fancy-cli` can keep reusing an old copy.")}\n` +
    `  ${dim("Run")} ${bold("npx fancy-cli@latest")} ${dim("to get the current one.")}\n`;

  stderr.write(message);

  return message;
}
