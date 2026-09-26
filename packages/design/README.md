# foss-design

Design canvases and design systems on your machine: live, animated, clickable screens on an infinite canvas, served locally from a gitignored `.design` folder. Built for coding agents (Claude Code, Codex and other Agent Skills clients), usable by hand.

```bash
npx -y foss-design init            # .design/ + .gitignore entry
npx -y foss-design system init     # starter design system
npx -y foss-design new onboarding  # a canvas with one screen
npx -y foss-design preview         # the local viewer; prints its URL
```

Or install the `design` command globally: `npm i -g foss-design`.

![A canvas in the foss-design viewer: four live phone screens of an onboarding flow](https://raw.githubusercontent.com/wiolett-industries/foss-design/main/docs/images/canvas.png)

![The inspector: a button selected on a live screen, with its box model and design tokens](https://raw.githubusercontent.com/wiolett-industries/foss-design/main/docs/images/inspector.png)

## What you get

- **Canvases.** `.design/canvas/<id>/canvas.json` lays out pages → sections → screens, URL frames, notes and images. Screens are React components (`.tsx`, default export) or HTML pages, each rendered live in its own frame with hot reload: animations, forms and navigation work. Frames use device presets (`phone`, `tablet`, `desktop`…) or any size, and `"height": "auto"` for long pages.
- **A design system.** `.design/system/` holds `tokens.css` (light and dark CSS variables mapped to Tailwind v4 utilities), components importable as `@system/components/…`, specimens, guidelines and assets. The viewer renders it as a style guide at `/system`.
- **Batteries.** Every screen gets Tailwind v4 with the tokens, React, `motion`, `lucide-react`, `clsx` and `tailwind-merge`, even in projects without them; the project's own packages and `design.json` aliases work too. `import { go, useTheme, useScreen } from '@design/runtime'` links screens into prototypes.
- **Checks for agents.** `design check --render` loads every screen in Chrome and reports errors; `design shot` writes PNGs an agent can look at.
- **Sharing.** `design build --tar` produces a static site of the canvases and the system for any static host, or [foss-design Cloud](https://fossdesign.dev) syncs `.design` between machines and people: `design login`, `design link`, `design push`, `design pull`.

## Commands

| Command | What it does |
| --- | --- |
| `init [--name] [--no-gitignore]` | Create `.design` and ignore it in git. |
| `system init [--name] [--empty]` | Scaffold `.design/system`. |
| `new <canvas> [--title] [--empty]` | Scaffold a canvas. |
| `preview [--open [path]] [--port] [--restart] [--foreground]` | Start or reuse the viewer and print its URL. |
| `stop`, `status` | Stop the viewer; show its state, a project summary and the cloud state. |
| `check [canvas…] [--render] [--json]` | Validate the project; `--render` also loads every screen in Chrome. |
| `shot <canvas>[/<screen>] [--page] [--theme] [--out] [--overview]` | Screenshot screens or whole pages. |
| `build [canvas…] [--out] [--tar]` | Static site. |
| `login`, `logout` | Sign this machine in to foss-design Cloud (a link with the code in it). |
| `link [<project>] [--new <name>]` | List cloud projects, or link `.design` to one. |
| `push [canvas…] [--resolved <unit>]`, `pull [canvas…] [--theirs <unit>]` | Sync with the cloud; exit 2 on a conflict. |

Requirements: Node.js 20.19+. `check --render` and `shot` need an installed Chrome, Chromium, Edge or Brave, or `DESIGN_CHROME` pointing at one.

Formats, agent skills and plugins: https://github.com/wiolett-industries/foss-design · Cloud: https://fossdesign.dev

MIT © Wiolett Industries
