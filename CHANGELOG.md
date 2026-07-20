# Changelog

All notable changes to `fancy-cli` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes land in MINOR releases. Read the entry, not the
> version number.

## [Unreleased]

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
