# Screens and runtime

Every screen renders in its own frame, served by the local dev server (Vite) with hot reload. A screen is either a **module screen** (`.tsx`, `.jsx`, `.ts`, `.js`, `.mjs`) or an **HTML screen** (`.html`, `.htm`).

## Module screens

Export a React component, preferably as the default export. If there is no default export, the first exported function is used.

```tsx
import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
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
          history.pushState(null, '', '/verify')
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
| Anything else in the project's `node_modules` | As usual: packages resolve by walking up from `.design`. In a monorepo whose app keeps its packages in its own folder (`packages/web/node_modules`), set `"app": "packages/web"` in `.design/design.json`: screens then import everything the app has, and React is the app's, one copy for screens, the runtime and the app's components. Run `design preview --restart` after changing it. |
| `@system/...` | `.design/system/...`, for example `@system/components/button`. |
| `@design/runtime` | The runtime API below. |
| Aliases from `.design/design.json` | `{ "alias": { "@/": "src/", "@app": "src" } }`, paths relative to the project root. Lets screens import real project components. Run `design preview --restart` after changing it. |
| Relative paths | Other files in `.design`: shared modules, JSON fixtures, images (`import hero from './assets/hero.png'`). |

When screens import project components that style themselves with Tailwind classes, add their folders to `sources` in `.design/design.json` (`{ "sources": ["src/components"] }`) so those classes are generated.

When the app loads files from its public folder by root path (`<img src="/logo.png">`, `fetch('/config.json')`), point `public` in `.design/design.json` at that folder (`{ "public": "public" }`, relative to the project root) and run `design preview --restart`. Screens then load those paths as the app does, locally and in the cloud; dot-files and `node_modules` in the folder are left out. `design push` uploads the folder's files with every canvas it builds, so they count toward the cloud storage like the rest of the canvas (a file shared by several canvases counts once). A push rebuilds only the canvases that changed; after changing files in the public folder alone, `design push system` rebuilds and uploads every canvas with them.

In foss-design Cloud, `design push` builds the screens on this machine and uploads the result, so aliased project components show in the cloud as they do locally. A collaborator who pulls the canvas needs the same repository to preview it locally.

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
import { holdReady, useTheme, useScreen } from '@design/runtime'
```

| Export | What it does |
| --- | --- |
| `useTheme(): 'light' \| 'dark'` | The theme the frame is shown in; re-renders on change. |
| `useScreen(): { canvas, id, props }` | Where this frame sits and the props `canvas.json` gave it. |
| `holdReady(): () => void` | Keeps the frame from counting as ready until the returned function is called. |

A frame is ready once it has painted: the viewer then shows it, `design check --render` and `design shot` look at it, and the viewer takes the snapshot the zoomed-out canvas and canvas cards show. A screen that takes longer (a whole app loading its data) or sets up its state after loading (opens a dialog, picks a tab) holds that moment until it is done. Call `holdReady()` while the screen loads, at the top of its module or in its first render, and call what it returns once the screen shows what it should:

```tsx
const release = holdReady()
try {
  const { startApp } = await import('./app') // the heavy part loads after the hold is taken
  await startApp(root)
  await openDialog()
} finally {
  release()
}
```

Take the hold first and load a whole app with `await import()` after it, so nothing slow runs before the frame knows to wait.

`design check --render` waits up to 20 seconds for the release and reports a hold never released. Until the frame is ready, `history.pushState` and `replaceState` stay in the frame: a screen can put the app at its route and open a dialog without the viewer moving to another screen. A hot reload that reloads the whole frame brings back the screen, not the address the app moved to. Once someone clicks or types in a frame, it takes no snapshot until it loads again, so the snapshot never shows a state a person or a test left behind. Clicks a screen makes itself (user-event opening a dialog) do not count.

`go()` was removed in 0.5: `design check` reports it as an error, in screens and in the scripts beside them, and `design push` refuses canvases that use it.

## Links between screens

Screens link like the app does, and never need anything design-specific for it:

- Give every screen that stands for a page of the app its URL as `route` in `canvas.json` (`"route": "/settings"`, patterns such as `/orders/:id`; see the canvas.json reference).
- Links are plain links: `<a href="/settings">`, the app's own `Link` components, nav items with `href`. Clicking one opens the screen whose route matches.
- Moves from code (after a form submits, a timer, a wizard step) go through the history API, as a router does: `history.pushState(null, '', '/verify')`, or the app router's `navigate('/verify')` when the screen has one.
- Interaction inside one screen (tabs, modals, filters, form steps) stays in React state.
- A destination with no screen is `href="#"`; do not invent paths.

The runtime keeps the frame on its screen whatever a link does: a link to another site opens in a new tab, `#section` links scroll, a path no route matches stays put with a note (and a warning in `design check --render`), and a router inside the screen keeps working for paths no other screen has.

Screens run in a normal browser page on `localhost`: they may call real APIs and load remote images and fonts. Everything else (Tailwind, the tokens, the shipped packages, local assets) works offline. Prefer local sample data in screens so designs do not depend on a network or a running backend.

## Checks

- `design check <canvas> --render` loads every screen in headless Chrome and reports build errors, uncaught exceptions and console errors, plus `canvas.json` problems, `go()` calls, and links that lead to no screen (grouped by path, with the screens they appear in).
- `design shot <canvas>[/<screen>] [--theme dark] [--page <id>] [--overview]` writes PNGs and prints their paths. Read them to review the result.
- The viewer's frames show Vite's error overlay for syntax and import errors while you edit.
