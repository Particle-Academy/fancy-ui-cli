# Changelog

All notable changes to `fancy-cli` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes land in MINOR releases. Read the entry, not the
> version number.

## [Unreleased]

## [0.6.0] - 2026-07-30

### Added

- **The CLI now tells you when it is out of date.** `npx` caches by package
  name, so plain `npx fancy-cli …` happily reuses a copy from months ago — and
  every install string the docs, the MCP tools and the plugins published said
  exactly that rather than `npx fancy-cli@latest …`. A developer could sit on a
  months-old CLI indefinitely with nothing to indicate it.

  The check runs **after** the command, only on success, writes one line to
  stderr, times out at 1.5s, and swallows every failure — offline, proxied or
  blocked registries stay silent. `FANCY_CLI_NO_UPDATE_CHECK=1` turns it off.

- **`schemaVersion` is enforced.** It has been on the manifest type since the
  first release and was **never read**. An older CLI meeting a node that uses a
  newer manifest field did not fail — it installed the parts it recognised and
  dropped the rest in silence, surfacing later as "the node is in my palette but
  it doesn't run", with nothing pointing at the cause. A manifest declaring a
  schema above `SUPPORTED_SCHEMA_VERSION` is now a hard error naming the fix.

  **No node is affected today** — all eight published nodes declare
  `schemaVersion: 1`, and a manifest omitting it is treated as v1, so nothing
  that installs now stops installing.

### Fixed

- An undetectable host runtime no longer swallows other problems.
  `checkNodeCompat` returned a fresh array in that branch, discarding anything
  found earlier — so "I can't tell your runtime" would have hidden "this CLI is
  too old to install this node", the more fundamental of the two.

### Changed

- Every published install string now reads `npx fancy-cli@latest add …` — 27
  of them across the CLI, both editor plugins, the showcase docs, the MCP tools
  and the registry sources. **Node *content* never needed a CLI update** (`add
  node` reads the live registry), but CLI *features* always did, and the command
  we told people to run was the one that could silently skip them.

## [0.5.0] — 2026-07-26

### Added

- **`add node` prints the Fancy packages a node needs, and how to get each one.**

  A node is copied into your project, not installed, so nothing resolves its
  imports for it. Until now the first sign that `llm_screen` needed
  fancy-screens was a module-not-found at build time, naming a package you never
  chose.

  ```
  Fancy packages this node uses — not installed for you; pick a route
    needed  fancy-screens — renders the generated schema
        npm      npm install @particle-academy/fancy-screens
        vendor   fancy-cli add fancy-screens
  ```

  Routes are filtered by what the project can actually do: `composer require`
  only appears on a PHP host, while an npm-only package is offered **everywhere**
  — the node's UI comes down whichever backend you pick, because the editor is
  React even in a Laravel app. Vendoring is always offered.

  Reads `fancyDependencies` from the node manifest (fancy-flow 0.33.0+). **No
  version is ever printed**, by contract — a range shown here gets pasted into a
  manifest, and the pin the validator refuses arrives by the back door.

  **Nothing to do.** Nodes without the field print nothing, as before.

## [0.4.0] — 2026-07-26

### Changed

- **BREAKING: `add node` copies a node's SOURCE instead of installing packages.**
  A node is now vendored, exactly like a component: the files land in your
  project where you can read, edit and diff them, rather than in `node_modules`
  and `vendor` as two packages that have to be kept in step.

  ```
  components/fancy/flow-nodes/<node>/ui/…   the React kind — palette + config panel
  components/fancy/flow-nodes/<node>/js/…   the TypeScript executor  (--backend=js)
  app/Flow/Nodes/<node>/php/…               the PHP executor         (--backend=php)
  ```

  Both destinations are configurable in `fancy.json` via `dirs.flowNodes` and
  `dirs.flowNodesPhp`. `--overwrite` replaces files already on disk; without it
  they are reported as skipped, so a re-run never silently discards your edits.

  **What you must DO:** `add node` now needs a `fancy.json` (run
  `npx fancy-cli init`) because it has to know where to write. Nothing else —
  the registry served no nodes before this, so nothing was installed the old
  way. npm installs still happen for a node's own *dependencies*: the libraries
  its source imports, never the node itself.

## [0.3.0] — 2026-07-26

### Added

- **`add node --backend=php|js`**, and detection when you omit it.

  ```bash
  npx fancy-cli add node @particle-academy/ui_effect                 # detected
  npx fancy-cli add node @particle-academy/ui_effect --backend=php   # explicit
  ```

  A `composer.json` means PHP executes here and wins the detection: an Inertia
  app has both manifests, and in that pairing PHP is running the workflow while
  npm is only carrying the editor. `laravel` / `composer` and `node` / `npm` /
  `ts` are accepted spellings, and `none` / `ui-only` take the surface alone —
  for a project that authors graphs but never runs them. A typo is an **error**,
  not a quiet fall back to detection: passing the flag means you did not want
  the guess.

### Fixed

- **A node's UI now arrives whichever backend runs it.** `add node` installed a
  package per runtime the project executes on, treating `ts` and `php` as
  interchangeable. But a node is a UI *and* a backend, and the UI is
  React on every host — a Laravel app still renders the editor in a browser. So
  a PHP project could install a node it was able to execute and unable to see:
  no palette entry, no config panel, and nothing saying why.

  The surface is copied whenever a node publishes one, and the backend choice
  decides only what runs the graph. A node with no backend for your choice is
  still refused (`--force` overrides).

## [0.2.1] — 2026-07-20

### Fixed

- Type errors under `noUncheckedIndexedAccess` in the edit-distance and version
  comparison helpers. 0.2.0 published with a **failing lint job** — the tests,
  the build, and an end-to-end run against a stub registry all passed, because
  `tsup` does not typecheck and only `tsc --noEmit` does. Runtime behaviour was
  correct in 0.2.0; this is types only.

## [0.2.0] — 2026-07-20

### Added

- **Workflow node commands** — `add node`, `list nodes`, `search nodes`.

  A component is vendored as source. A **node** is a kind definition plus an
  executor for *each runtime you execute on*, so it installs as packages, per
  runtime, after a compatibility check.

  ```bash
  npx fancy-cli search nodes "route with an llm"
  npx fancy-cli add node @acme/salesforce_upsert
  ```

  `add node` checks the node against the runtimes **your** project executes on —
  read from `@particle-academy/fancy-flow` in `package.json` and
  `particle-academy/fancy-flow-php` in `composer.json` — and **refuses** a node
  that doesn't implement one, or that needs an engine newer than yours.

  That refusal is the point of the command. Without it the node installs
  cleanly, appears in the palette, and fails at run time, which looks like it
  worked. Requested by the MOIC Suite consumer, who runs the editor in TS and
  executes in PHP and hit exactly this.

  On success it prints what must be wired before the node can run: required
  capabilities, whether it pauses for a human (needs a resume path; can't be
  embedded in an unattended workflow), and whether it's unsafe to replay
  (durable runs retry).

  PHP dependencies are printed for you to run, never executed — a PHP project's
  dependency resolution isn't something a JS CLI should trigger on your behalf.
  They print *before* the npm install so a failing install can't swallow them.

- `search nodes` matches category as well as kind/title/description, because the
  useful query is often a concept rather than a name.

### Fixed

- **`--no-install` now actually disables installing.** Node's `parseArgs` does
  not negate `--no-install` into `install: false` — it records a separate
  `no-install` key and leaves the default `true`. **Every `--no-install` since
  this CLI shipped ran the package manager anyway**, including for
  `add <component>`, which is the opposite of what the flag advertises.

  **What to do:** nothing, unless you were relying on the broken behaviour by
  passing `--no-install` and expecting an install. Found by running the built
  binary rather than by a test, and now pinned by one against the exported
  resolution rather than a copy of it.

- A node's manifest is resolved through the registry index's `url` rather than a
  path built from the kind id. A kind contains a slash (`@acme/route_llm`), so
  building a path meant percent-encoding a path separator, and `%2F` is handled
  inconsistently by static hosts, CDNs, and proxies. Going through the index
  also makes "did you mean" possible — a 404 on a constructed path knows nothing
  about what does exist.

- Unknown node ids suggest near matches by **edit distance**, not substring. The
  dominant reason to land there is a typo, and `route_lm` is not a substring of
  `route_llm` in either direction.

- **`--version` reported the wrong version.** The string is hardcoded in
  `src/index.ts` (deliberately — the bundled binary does no runtime `fs` read of
  `package.json`) and was left at `0.1.0` when 0.1.1 shipped. The comment says
  "kept in sync with package.json by the build"; nothing was enforcing that.

### Notes

`satisfiesRange` here is a third implementation of the same small semver subset
(fancy-flow and fancy-flow-php have the others), so a zero-dependency vendoring
CLI doesn't have to pull in a workflow engine. All three are pinned by an
identical case table in each repo's tests — change one, change all three.

[Unreleased]: https://github.com/Particle-Academy/fancy-ui-cli/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Particle-Academy/fancy-ui-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Particle-Academy/fancy-ui-cli/compare/v0.1.1...v0.2.0
