# fancy-ui

The **`fancy-ui` CLI** is the *vendor path* for [Fancy UI](https://ui.particle.academy) — it fetches component source from the hosted registry and writes the files into **your** project, so you own the code (the shadcn-style "copy the source" flow).

Once a component is vendored it's just files in your codebase. There is no runtime dependency on this CLI: delete `fancy.json`, uninstall the CLI, and the vendored components keep working.

> The npm-install path (`@particle-academy/react-fancy`, etc.) remains a first-class citizen. The CLI is for people who want to own and customize the source.

## Installation

Run it with `npx` — no global install required. The `@latest` tag keeps you on the registry-compatible version:

```bash
npx @particle-academy/fancy-ui@latest init
```

Pin a version for reproducibility:

```bash
npx @particle-academy/fancy-ui@0.1.0 init
```

**Requires Node 18+** (global `fetch`). Zero runtime dependencies.

## Quick start

```bash
npx @particle-academy/fancy-ui@latest init        # configure the project (writes fancy.json)
npx @particle-academy/fancy-ui@latest add card    # vendor a component + its deps
npx @particle-academy/fancy-ui@latest list        # browse everything available
```

## Commands

### `init`

Configures your project for the vendor flow. Run it once per project. It's interactive (powered by `node:readline/promises`) and asks for:

- **Components directory** — where source lands on disk (default `src/components/fancy`)
- **Import alias** — the alias for that directory (default `@/components/fancy`)
- **Tailwind CSS file** — the stylesheet a component extends if it ships CSS (default `src/index.css`)
- **Auto-install peer deps** — whether `add` should run your package manager (default yes)

It writes a `fancy.json` at the project root and **refuses to clobber an existing one** unless you pass `--force`.

| Flag | Effect |
|---|---|
| `--yes` | Accept every default non-interactively. |
| `--force` | Overwrite an existing `fancy.json`. |

```bash
npx @particle-academy/fancy-ui init
npx @particle-academy/fancy-ui init --yes          # CI-friendly, all defaults
npx @particle-academy/fancy-ui init --force        # reconfigure an existing project
```

### `add <name...>`

Fetches one or more components and writes them to disk. For each name:

1. Fetches `{registry}/r/{name}.json`.
2. Writes each `file.content` to its resolved on-disk path (`{componentsDir}/{slug}/{file}`).
3. **Recursively resolves `registryDependencies`** — fetches and writes them too, deduped, **skipping files that already exist on disk** unless `--overwrite`.
4. Collects every `dependencies` entry across the whole bundle, dedupes, and installs the missing npm packages using **your project's package manager** (detected from the lockfile: npm / pnpm / yarn / bun).

It **never overwrites a file you've already vendored** unless you pass `--overwrite`, and prints a clean summary of files written, files skipped, registry deps pulled, and npm deps installed.

| Flag | Effect |
|---|---|
| `--overwrite` | Replace files that already exist on disk. |
| `--no-install` | Don't run the package manager; just print the install command. |

```bash
npx @particle-academy/fancy-ui add card
npx @particle-academy/fancy-ui add card calendar accordion
npx @particle-academy/fancy-ui add card --overwrite
npx @particle-academy/fancy-ui add card --no-install
```

### `list`

Show every component in the registry, grouped by package with a per-package count and aligned `name  title  description` columns:

```bash
npx @particle-academy/fancy-ui list

# react-fancy (54)
#   accordion   Accordion   Stateful disclosure surface.
#   button      Button      The flexible button.
#   card        Card        Container with header/body/footer.
#   ...
# fancy-flow (3)
#   flow-editor FlowEditor  Workflow canvas + executor.
```

`list` and `search` work even without a `fancy.json` — they fall back to the default registry.

### `search <query>`

Case-insensitive substring match across `name`, `title`, and `description`:

```bash
npx @particle-academy/fancy-ui search calendar
```

### `diff <name>`

Compare your local vendored copy against the latest registry version and print a unified diff. Useful for spotting upstream improvements you might want to merge in. **It never applies changes** — the whole point of vendoring is that you may have customized the local copy.

```bash
npx @particle-academy/fancy-ui diff card
```

The diff is a self-contained LCS-based unified diff (no `git` required).

### Global flags

| Flag | Effect |
|---|---|
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Print the CLI version. |

## Configuration reference (`fancy.json`)

`init` writes this file; `add` and `diff` read it.

```json
{
  "$schema": "https://ui.particle.academy/schema/fancy.json",
  "registry": "https://ui.particle.academy",
  "aliases": {
    "components": "@/components/fancy",
    "utils": "@/lib/utils"
  },
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/index.css"
  },
  "dirs": {
    "components": "src/components/fancy"
  }
}
```

| Key | Default | What it controls |
|---|---|---|
| `registry` | `https://ui.particle.academy` | Base URL of the registry. Override for a self-hosted mirror. |
| `aliases.components` | `@/components/fancy` | Import alias for vendored components. |
| `aliases.utils` | `@/lib/utils` | Import alias for shared utilities (the `cn` helper). |
| `rsc` | `false` | If true, mark client components with `"use client"`. (No-op for React 19 server components today.) |
| `tsx` | `true` | Emit `.tsx` (true) or `.jsx` (false). |
| `tailwind.css` | `src/index.css` | Stylesheet to extend if a component ships CSS. |
| `dirs.components` | `src/components/fancy` | **Concrete on-disk directory** where component files are written. |

### How on-disk paths are resolved

The registry's file `target` is always `components/fancy/{slug}/{file}`. The CLI maps the `components/fancy/` prefix onto your configured components directory, so a file lands at `{dirs.components}/{slug}/{file}`.

`dirs.components` is **schema-additive** — it captures the concrete directory so the CLI never has to parse `tsconfig.json` path aliases. If `dirs.components` is absent, the directory is derived **deterministically** from `aliases.components` by replacing a leading `@/` with `src/` (e.g. `@/components/fancy` → `src/components/fancy`).

## Self-hosting the registry

Point `registry` at any URL that follows the [registry contract](https://ui.particle.academy/docs/registry). The CLI doesn't care whether it's the hosted registry, a private mirror, or a local file server — as long as:

- `GET {registry}/r/index.json` returns `{ "items": [ { name, type, title, description, package, files, url } ] }`
- `GET {registry}/r/{name}.json` returns `{ name, type, title, description, package, dependencies, registryDependencies, files: [ { path, content, type, target } ] }`

`dependencies` are npm packages to install; `registryDependencies` are other registry slugs to vendor recursively.

## What this is *not*

- **Not a build tool.** Once components are vendored they're plain files; your existing bundler compiles them.
- **Not a runtime dependency.** Delete `fancy.json` and uninstall the CLI — the vendored components keep working.
- **Not the only way to use Fancy UI.** The npm-install path is fully supported; see the [installation docs](https://ui.particle.academy/docs/installation).

## License

MIT
