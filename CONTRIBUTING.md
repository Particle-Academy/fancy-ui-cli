# Contributing to fancy-cli

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Layout

- `src/index.ts` — the `fancy-cli` bin entry.
- `src/commands/` — one file per command (`init`, `add`, `add-node`, `list`,
  `search`, `diff`, `nodes`).
- `tests/` — vitest suites, one per area.

## Build and test

```bash
npm run build   # tsup
npm run lint    # tsc --noEmit
npm test        # vitest run
```

- The CLI has **zero runtime dependencies** and needs Node 22+ (global `fetch`).
- `tests/readme.test.ts` reads `README.md`: every `npx fancy-cli` invocation
  must be pinned (`@latest` or a version), and no pin may be older than 0.8.2.
  Keep that true when editing the README.

## Changelog

Update `CHANGELOG.md` in the same commit as the change.
