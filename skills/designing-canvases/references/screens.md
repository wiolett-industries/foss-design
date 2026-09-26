# Screens and runtime

Every screen renders in its own frame, served by the local dev server (Vite) with hot reload. A screen is either a **module screen** (`.tsx`, `.jsx`, `.ts`, `.js`, `.mjs`) or an **HTML screen** (`.html`, `.htm`).

## Module screens

Export a React component, preferably as the default export. If there is no default export, the first exported function is used.

```tsx
import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { go, useTheme } from '@design/runtime'
import { Button } from '@system/components/button'

export default function SignUp({ error }: { error?: string }) {
  const [email, setEmail] = useState('')
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6">
      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={(event) => {
          event.preventDefault()
          go('verify')
        }}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="text-title font-semibold text-ink">Create your account</h1>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          className="h-11 rounded-control border border-rule bg-surface px-3 text-body"
        />
        {error ? <p className="text-caption text-danger">{error}</p> : null}
        <Button kind="primary" type="submit">
          Continue <ArrowRight size={16} />
        </Button>
      </motion.form>
    </main>
  )
}
```

- `props` from `canvas.json` arrive as the component's props.
- The component renders into `#root` inside an error boundary. A crash shows the message and stack in the frame and is reported by `design check --render`.
- Keep a screen self-contained. Split big screens into local modules next to them (`screens/checkout/Summary.tsx`) and import them relatively.
- React Fast Refresh keeps state across edits when the file exports only components.

## What screens can import

| Import | Resolves to |
| --- | --- |
| `react`, `react-dom` | The project's React when it has one; otherwise the copy foss-design ships. Always a single React for screens, the runtime and project components. |
| `motion` (`motion/react`), `lucide-react`, `clsx`, `tailwind-merge` | The project's copy when present, otherwise the shipped one. |
| Anything else in the project's `node_modules` | As usual: packages resolve by walking up from `.design`. |
| `@system/...` | `.design/system/...`, for example `@system/components/button`. |
| `@design/runtime` | The runtime API below. |
| Aliases from `.design/design.json` | `{ "alias": { "@/": "src/", "@app": "src" } }`, paths relative to the project root. Lets screens import real project components. Run `design preview --restart` after changing it. |
| Relative paths | Other files in `.design`: shared modules, JSON fixtures, images (`import hero from './assets/hero.png'`). |

When screens import project components that style themselves with Tailwind classes, add their folders to `sources` in `.design/design.json` (`{ "sources": ["src/components"] }`) so those classes are generated.

## Styles

Unless the canvas or the item sets `"system": false`, every screen gets:

- **Tailwind v4**, generated from every file in `.design` (and the `sources` folders). Arbitrary values (`w-[372px]`) work.
- **The design tokens** from `.design/system/tokens.css` as utilities: `bg-surface`, `text-ink`, `rounded-control`, `text-body`, `font-sans`, and whatever else the system defines. Prefer them over raw values.
- A `dark:` variant bound to the viewer's theme toggle.

If `system.json` names a custom `stylesheet`, that stylesheet replaces the default Tailwind + tokens entry.

With `"system": false` nothing is injected: import your own CSS from the screen (`import './checkout.css'`) or style inline.

## Theme

The viewer sets `data-theme="light"` or `data-theme="dark"` and the `dark` class on `<html>`, and `color-scheme` to match, before the first paint. Token values switch through `:root[data-theme="dark"]` in `tokens.css`; `dark:` utilities work as expected. `useTheme()` returns the current theme for the rare case a component needs it in JavaScript. Pin a screen's theme with `"theme"` in `canvas.json`.

## Runtime API (`@design/runtime`)

```ts
import { go, useTheme, useScreen } from '@design/runtime'
```

| Export | What it does |
| --- | --- |
| `go(target: string)` | Moves to another screen. `target` is a screen id on the same canvas, or `page-id/screen-id`. On the canvas the viewer brings the target into view and selects it; in play mode it opens it. Outside the viewer it only logs. |
| `useTheme(): 'light' \| 'dark'` | The theme the frame is shown in; re-renders on change. |
| `useScreen(): { canvas, id, props }` | Where this frame sits and the props `canvas.json` gave it. |

Clickable prototypes: keep interaction state in React state inside the screen (tabs, modals, form steps), and use `go()` only to move between frames that are separate screens on the canvas.

## Frame size and scrolling

- A fixed frame (`device`, or numeric `width`/`height`) is one viewport: the page scrolls inside it, `100vh`/`min-h-screen` equals the frame height, and `position: fixed` headers behave like on a device.
- `"height": "auto"` grows the frame to the content (up to 40 000 px). Use it for landing pages and long documents. Content height is measured from the body's children, so avoid layouts whose height depends on the viewport alone (`h-screen` on the only child) in auto frames; `min-h-screen` is fine.
- The canvas shows frames at the zoom level but never rescales their content: design for the frame's CSS size.

## HTML screens

An `.html` file (with anything next to it: CSS, JS, images) is served as a page. foss-design adds to its `<head>`: the frame configuration, the design system stylesheet, `system.json` fonts, and the runtime (theme, size reporting, error reporting).

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Landing</title>
  <link rel="stylesheet" href="./landing.css">
</head>
<body>
  <main class="mx-auto max-w-5xl px-6 py-24">…</main>
  <script type="module" src="./landing.ts"></script>
</body>
</html>
```

- Relative URLs resolve next to the HTML file; module scripts go through Vite, so TypeScript, JSX and npm imports (including `@design/runtime` and `@system/...`) work inside them.
- Opt out of the design system stylesheet with `<meta name="design:system" content="off">` (or `"system": false` in `canvas.json`) when the page brings its own complete styling.
- Use HTML screens for static marketing pages, emails, print pieces and ports of existing HTML; use module screens for anything interactive.

## Assets and fonts

- Images and media for one canvas: `.design/canvas/<id>/assets/`, imported from module screens (`import src from '../assets/photo.jpg'`) or referenced relatively from HTML screens.
- Shared brand assets (logos, icons, font files): `.design/system/assets/`.
- Web fonts: list stylesheet URLs (such as Google Fonts) in `system.json` `fonts`; every screen loads them. Self-hosted fonts: `@font-face` in `tokens.css` with files in `system/assets/fonts/`.

## Online and offline

Screens run in a normal browser page on `localhost`: they may call real APIs and load remote images and fonts. Everything else (Tailwind, the tokens, the shipped packages, local assets) works offline. Prefer local sample data in screens so designs do not depend on a network or a running backend.

## Checks

- `design check <canvas> --render` loads every screen in headless Chrome and reports build errors, uncaught exceptions and console errors, plus `canvas.json` problems.
- `design shot <canvas>[/<screen>] [--theme dark] [--page <id>] [--overview]` writes PNGs and prints their paths. Read them to review the result.
- The viewer's frames show Vite's error overlay for syntax and import errors while you edit.
