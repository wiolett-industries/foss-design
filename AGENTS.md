# Agent guide

This repository holds foss-design: the `foss-design` npm package (CLI, preview server, screen runtime, viewer) and the Agent Skills that teach coding agents to use it.

## Map

| Area | Location | Purpose |
| --- | --- | --- |
| Formats | `packages/design/src/core/` | `schema.ts` (design.json, system.json, canvas.json), `canvas.ts`, `system.ts`, `tokens.ts` (token parsing), `project.ts`. |
| Server | `packages/design/src/server/` | Vite in middleware mode, generated frame entries, shipped-package links, API, events, snapshots. |
| Runtime | `packages/design/src/runtime/` | Code injected into every frame: theme, size reporting, `go()`, errors, snapshots, the inspector. Frames may sit on another origin than the viewer (see `viewer/src/lib/frames.ts`), so the viewer talks to them only through postMessage. Built to `dist/runtime`. |
| CLI | `packages/design/src/cli/` | Commands; `index.ts` holds the help text, which is the CLI contract. |
| Capture | `packages/design/src/capture/` | Chrome launching and frame loading for `check --render` and `shot`. |
| Viewer | `packages/design/viewer/` | The React app served at `/`, built to `dist/viewer`. |
| Skills | `skills/<name>/` | `SKILL.md`, `references/`, `agents/openai.yaml`. |
| Plugins | `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/` | Plugin and marketplace metadata. |
| Example | `examples/` | A project with a `.design` folder, for trying changes end to end. |

## Rules

- The skills document behavior; the code defines it. When a format, a default or a CLI flag changes, update `skills/*/references/*` and `README.md` in the same change.
- Keep the plugin name and version aligned in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `packages/design/package.json`.
- Every skill folder name equals its frontmatter `name`; descriptions stay on one line.
- No hooks: installing the plugin must not change a user's settings or run anything.
- Screens are the user's code: the server must never modify files outside `.design/.cache` and `.design/node_modules`.

## Verify

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
cd examples/<project> && node ../../packages/design/dist/cli.js check --render
```

For viewer or runtime changes, also run `design preview` in an example project and look at a canvas and `/system` in a browser, in both themes.
