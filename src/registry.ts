import { CliError } from "./errors.js";

export interface RegistryIndexItem {
  name: string;
  type: string;
  title: string;
  description: string;
  package: string;
  files: number;
  url: string;
}

export interface RegistryIndex {
  $schema?: string;
  name?: string;
  homepage?: string;
  items: RegistryIndexItem[];
}

export interface RegistryFile {
  path: string;
  content: string;
  type: string;
  target: string;
}

export interface RegistryItem {
  $schema?: string;
  name: string;
  type: string;
  title: string;
  description: string;
  package: string;
  dependencies: string[];
  registryDependencies: string[];
  files: RegistryFile[];
}

function joinUrl(base: string, p: string): string {
  const b = base.replace(/\/+$/, "");
  const rest = p.replace(/^\/+/, "");
  return `${b}/${rest}`;
}

function assertValidRegistry(registry: string): void {
  let url: URL;
  try {
    url = new URL(registry);
  } catch {
    throw new CliError(
      `Invalid registry URL: "${registry}".`,
      `It must be an absolute URL like https://ui.particle.academy.`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError(
      `Invalid registry URL: "${registry}".`,
      `Only http(s) registries are supported.`,
    );
  }
}

async function fetchJson<T>(url: string, notFoundMsg?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new CliError(
      `Network error fetching ${url}`,
      (err as Error).message,
    );
  }
  if (res.status === 404) {
    throw new CliError(notFoundMsg ?? `Not found: ${url} (404).`);
  }
  if (!res.ok) {
    throw new CliError(`Registry returned ${res.status} ${res.statusText} for ${url}.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CliError(`Registry returned non-JSON from ${url}.`);
  }
  // Registry signals a missing item as `{ "error": "..." }` with a 200 in some setups.
  if (body && typeof body === "object" && "error" in (body as object)) {
    const msg = String((body as { error: unknown }).error);
    throw new CliError(notFoundMsg ?? `Registry error: ${msg}`);
  }
  return body as T;
}

export async function fetchIndex(registry: string): Promise<RegistryIndex> {
  assertValidRegistry(registry);
  const url = joinUrl(registry, "/r/index.json");
  const index = await fetchJson<RegistryIndex>(url);
  if (!index || !Array.isArray(index.items)) {
    throw new CliError(`Registry index at ${url} is malformed (missing "items").`);
  }
  return index;
}

export async function fetchItem(
  registry: string,
  name: string,
): Promise<RegistryItem> {
  assertValidRegistry(registry);
  const url = joinUrl(registry, `/r/${encodeURIComponent(name)}.json`);
  const item = await fetchJson<RegistryItem>(
    url,
    `Component "${name}" not found in the registry (${url}).`,
  );
  // Normalize possibly-missing arrays.
  item.dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
  item.registryDependencies = Array.isArray(item.registryDependencies)
    ? item.registryDependencies
    : [];
  item.files = Array.isArray(item.files) ? item.files : [];
  return item;
}
