# foss-design

Design canvases and design systems for coding agents, on your own machine.

![A canvas in the foss-design viewer: four live phone screens of an onboarding flow, with pages and layers on the left](docs/images/canvas.png)

foss-design replaces the design canvas and design system parts of Claude Artifacts / Claude Design with something that lives in your repository and needs no account:

- **Live screens on an infinite canvas.** Every artboard is a real page, a React component or an HTML file, rendered in its own frame: animations, hover states, forms and navigation work. Pages, sections, notes, pan and zoom, a play mode, light and dark.
- **A design system next to it.** Tokens become Tailwind v4 utilities in every screen, components are importable, and the viewer turns it all into a style guide: colors, typography, spacing and shape, motion, component specimens, guidelines, assets.
- **Files, not uploads.** Everything is in a gitignored `.design/` folder. The viewer is a local dev server with hot reload; there is nothing to publish, no size limit, no capability flags.
- **Any agent.** Two skills teach Claude Code, Codex and other Agent Skills clients the format and the workflow; the `design` CLI checks screens in Chrome and screenshots them so the agent can review its own work.

## Quick start

Install the skills for your agent (pick one route):

```bash
# Any Agent Skills client
npx skills add wiolett-industries/foss-design

# Claude Code plugin
claude plugin marketplace add wiolett-industries/foss-design
claude plugin install foss-design@foss-design

# Codex plugin
codex plugin marketplace add wiolett-industries/foss-design --ref main
codex plugin add foss-design@foss-design
```

Then ask for a design in a new session: "Design the onboarding flow for this app on a canvas." The agent runs the CLI through `npx -y foss-design`, or `design` if you installed it globally:

```bash
npm i -g foss-design
```

By hand:

```bash
design init                # .design/ + .gitignore entry
design system init         # starter tokens, guideline and component
design new onboarding      # a canvas with one screen
design preview             # the viewer, in the background; prints the URL (--open to open a browser)
```

Requirements: Node.js 20.19 or newer. `check --render` and `shot` use an installed Chrome, Chromium, Edge or Brave (or the binary in `DESIGN_CHROME`).

## The .design folder

```
.design/
  design.json                  name, import aliases, extra Tailwind sources, port
  system/
    system.json                name, description, web fonts, optional custom stylesheet
    tokens.css                 CSS variables (light, dark) and the @theme mapping to Tailwind
    components/                components screens import as @system/components/…
    specimens/                 one page per component, every variant and state
    guidelines/                Markdown pages
    assets/                    logos, icons, fonts, imagery
  canvas/
    <canvas-id>/
      canvas.json              pages → sections → screens, URLs, notes, images
      screens/                 .tsx (default export) or .html
      assets/
  .cache/                      generated; safe to delete
```

A minimal `canvas.json`:

```json
{
  "title": "Onboarding",
  "pages": [
    {
      "id": "flow",
      "title": "Flow",
      "sections": [
        {
          "title": "Sign up",
          "items": [
            { "src": "screens/SignUp.tsx", "device": "phone" },
            { "src": "screens/Verify.tsx", "device": "phone" },
            { "type": "note", "text": "Verify accepts the code from the email or the magic link." }
          ]
        }
      ]
    }
  ]
}
```

Screens get Tailwind v4 with the design tokens, React, `motion`, `lucide-react`, `clsx` and `tailwind-merge` even when the project has none of them (the project's own copies win when present), plus the project's other packages and any aliases from `design.json`. A screen moves to another with `go('verify')` from `@design/runtime`.

The complete formats are in the skills: [canvas.json](skills/designing-canvases/references/canvas-json.md), [screens and runtime](skills/designing-canvases/references/screens.md), [design system](skills/building-design-systems/references/system-format.md).

## CLI

| Command | What it does |
| --- | --- |
| `design init [--name <name>] [--no-gitignore]` | Create `.design` and add it to `.gitignore`. |
| `design system init [--name <name>] [--empty]` | Scaffold `.design/system`: tokens, a guideline, a component and its specimen. |
| `design new <canvas> [--title <title>] [--empty]` | Scaffold `.design/canvas/<canvas>`. |
| `design preview [--open [path]] [--port <n>] [--restart] [--foreground]` | Start the viewer in the background, or reuse the running one, and print its URL. |
| `design stop` | Stop the viewer. |
| `design status` | Viewer state, a project summary and, when linked, the cloud state of each unit. |
| `design check [canvas…] [--render] [--json]` | Validate `canvas.json` and the system; `--render` loads every screen and specimen in Chrome and reports runtime errors. |
| `design shot <canvas>[/<screen>] [--page <id>] [--theme light\|dark] [--out <dir>] [--overview]` | Screenshot screens (or whole pages with `--overview`; `@system[/<id>]` for specimens); prints the PNG paths. |
| `design build [canvas…] [--out <dir>] [--tar]` | Build a static site of the canvases and the design system, optionally packed as an archive. |
| `design login` / `design logout` | Sign this machine in to [foss-design Cloud](#cloud) or forget its token. |
| `design link [<project>] [--new <name>]` | List your cloud projects, or link `.design` to one (or to a new one). |
| `design push [canvas…] [--resolved <unit>] [--json]` | Build and upload what changed; stops when the cloud is ahead. |
| `design pull [canvas…] [--theirs <unit>] [--json]` | Take cloud changes; a unit changed on both sides becomes a conflict (exit 2). |

`--root <dir>` points any command at a project; by default the nearest folder with `.design` is used. The viewer listens on a free port picked at start, so several projects can preview at once; `--port` or `"port"` in `design.json` pins one. It opens a browser only with `--open`.

## Viewer

![The inspector: the Continue button selected on a live screen, with its box model, typography and colors traced to design tokens](docs/images/inspector.png)

![The design system in the viewer: color tokens with light and dark values and their Tailwind utilities](docs/images/design-system.png)


- `/` lists canvases and the design system.
- `/c/<canvas>` is the canvas: drag or scroll to pan, pinch or ⌘/Ctrl + scroll to zoom, ⇧1 to fit. Click a screen to interact with it, Esc to leave, Enter or double-click to play it full size.

  Big canvases stay smooth: screens in view run live (up to 12, a few loading at a time once the camera rests), screens you passed sleep behind a snapshot and wake without reloading, and the rest show snapshots. The dev server loads frames from the viewer's twin host (`127.0.0.1` when the viewer is on `localhost`, and the other way round), so the browser runs them in their own process and they cannot stall panning; open the viewer on either of the two for that. Zooming out stops at half of the fit-to-page zoom.
- `/c/<canvas>/play/<screen>` shows one screen with previous and next.
- **Inspect** (the button in the top bar, or `I`) on the canvas and in play: hover a screen to see margin, padding and content, click an element for the right-hand panel — the React component that rendered it and its file, box model, layout, typography, colors, radius and shadow traced back to design tokens, Tailwind classes, attributes, children — and copy its CSS. Clicks go to the inspector, not the screen. Hold ⌘/Ctrl to highlight without switching Inspect on; click while holding to pick.
- `/system` is the style guide.

## Cloud

foss-design works without an account. [foss-design Cloud](https://fossdesign.dev) is an optional service on top of the same `.design` folder: push it from one checkout and pull it into another, share a project with people as editors or viewers, and publish a canvas behind a public link. Free, Lite and Extra plans differ in limits; see [fossdesign.dev](https://fossdesign.dev).

```bash
design login                  # prints a link with the code in it; open it, confirm, the CLI is signed in
design link --new "My app"    # or: design link  (lists your projects), design link <project-id>
design push                   # builds the canvases that changed and uploads them
design pull                   # in another checkout, after design link <project-id>
```

- **Units.** The design system (`design.json` and `system/`) and each canvas (`canvas/<id>/`) sync on their own, with their own revisions, so people editing different canvases never collide. A design system change pushes every active canvas with it, because screens are built against the system.
- **Builds happen here.** `push` builds each unit locally and uploads the files, so screens that import project code through `alias` work in the cloud as they do in the viewer. The cloud never runs a build.
- **Conflicts.** `push` stops with exit 2 when the cloud is ahead: run `pull`. A unit changed on both sides is left as it is here and the cloud version goes to `.design/.cache/cloud/incoming/<unit>/`. Merge by hand, then `design push --resolved <unit>`; `design pull --theirs <unit>` takes the cloud version instead.
- **State.** The link lives in `.design/cloud.json` (gitignored with the rest of `.design`), the token in `~/.config/foss-design/credentials.json` (mode 0600; `%APPDATA%` on Windows). `FOSS_DESIGN_CLOUD` points the CLI at another server.
- **Trust.** Pulled screens are code your collaborators wrote, and the local viewer lets screens read files in your repository. Invite as editors only people you trust. In the browser, cloud screens run on a separate domain (`*.fossdesignusercontent.com`) in sandboxed frames.

The web app embeds this package's viewer through `foss-design/viewer` (see `packages/design/viewer/src/library.ts`), with its data coming from the cloud instead of the local server.

## Turn off Claude Artifacts

With foss-design installed you probably want Claude Code to stop reaching for Artifacts and the built-in design canvas. In `~/.claude/settings.json`:

```json
{
  "enableArtifact": false,
  "skillOverrides": {
    "design": "off",
    "design-sync": "off",
    "artifact-design": "off",
    "artifact-diagramming": "off",
    "artifact-capabilities": "off"
  }
}
```

`enableArtifact: false` removes the Artifact tool (`/config` → Artifacts does the same); `skillOverrides` hides the bundled skills that depend on it. For publishing HTML elsewhere, `design build --tar` produces a static site any host can serve, such as Gateway Pages.

## Repository

- `packages/design/`: the `foss-design` npm package: CLI, preview server, screen runtime, viewer, and the viewer as a library (`foss-design/viewer`).
- `skills/`: `designing-canvases` and `building-design-systems`, consumed by `npx skills` and both plugin manifests.
- `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`: plugin and marketplace metadata.
- `examples/`: sample projects with their `.design` folders: `demo` (an animated onboarding flow and a desktop page), `system-demo` (a full design system), `verify` (fixtures for `check`, including a deliberately broken canvas).

Development:

```bash
pnpm install
pnpm build          # viewer + CLI + runtime
pnpm typecheck
pnpm lint
node packages/design/dist/cli.js --help
```

## Releasing

Publishing is tag-driven through GitHub Actions (`.github/workflows/release.yml`):

```bash
node scripts/versions.mjs --set 0.2.0     # package.json and both plugin manifests
git commit -am "Release 0.2.0"
git tag v0.2.0 && git push && git push --tags
```

On the tag the workflow checks that the tag matches every version, lints, typechecks, builds, installs the packed CLI with `npx` into an empty folder and runs `init`, `check --render`, `shot` and `build` there, then publishes to npm with provenance and creates a GitHub release with the tarball. A pre-release version (`0.2.0-beta.1`) publishes under the `next` dist-tag.

npm access, once: publish the first version by hand (`cd packages/design && npm login && npm publish --access public`), then on npmjs.com open the package → Settings → Trusted Publishing → GitHub Actions with organization `wiolett-industries`, repository `foss-design` and workflow `release.yml`, and set Publishing access to "Require two-factor authentication and disallow tokens". From then on tags publish with no token at all. (Alternatively put a short-lived granular token in an `NPM_TOKEN` repository secret for the first release and delete it after switching to trusted publishing.) The release job skips publishing when the version is already on npm.

## License

MIT © Wiolett Industries
