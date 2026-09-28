# System format

Everything under `.design/system/`. The viewer reads it live at `/system`; screens use it through the generated stylesheet and `@system/...` imports.

## system.json

```json
{
  "name": "Quorum",
  "description": "Multisig wallet console: calm, dense, exact.",
  "fonts": ["https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"],
  "sample": "Съешь же ещё этих мягких французских булок"
}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | string, required | System name in the viewer. |
| `description` | string | One line under the name. |
| `fonts` | array of URLs | Stylesheets every screen and specimen loads (`<link rel="stylesheet">`), such as Google Fonts. |
| `stylesheet` | path | Replaces the default Tailwind + `tokens.css` entry; relative to the system folder. See [Reusing the app directly](#reusing-the-app-directly). |
| `sample` | string | Text the typography page sets. Defaults to English and Russian pangrams. |
| `$schema` | string | Ignored; allowed for editors. |

The object is strict: unknown keys are errors. Without `system.json` the system still loads, with a warning and the name "Design system".

## tokens.css

The stylesheet every screen gets, after Tailwind v4. It is plain CSS with Tailwind directives, read in three scopes:

| Scope | Where | Meaning |
| --- | --- | --- |
| Light | rules on `:root`, `html`, `:host` | Base values. |
| Dark | rules whose selector has `[data-theme="dark"]` (also `data-mode`, `data-color-scheme`), `.dark`, `.theme-dark`, or any rule inside `@media (prefers-color-scheme: dark)` | Overrides for the dark theme. The viewer sets `data-theme` and the `dark` class on `<html>`, so `:root[data-theme="dark"]` is the canonical form. |
| Theme | `@theme`, `@theme inline`, `@theme static` blocks | Tailwind namespaces that become utilities. |

Declarations whose value is `initial`, and wildcard resets (`--color-*: initial`), are skipped.

### Namespaces

Variables in `@theme` are sorted into kinds by prefix, and the part after the prefix is the utility key:

| Prefix | Kind (viewer page) | Utilities |
| --- | --- | --- |
| `--color-` | Colors | `bg-*`, `text-*`, `border-*`, `fill-*`, `ring-*`… |
| `--font-` | Typography: families | `font-*` |
| `--font-weight-` | Typography: weights | `font-*` |
| `--text-` | Typography: type scale | `text-*` (size; with `--text-x--line-height`, line height too) |
| `--leading-`, `--tracking-` | Typography | `leading-*`, `tracking-*` |
| `--spacing`, `--spacing-` | Spacing & shape | `p-*`, `m-*`, `gap-*`, `w-*`… (`--spacing` is the base unit) |
| `--radius-` | Spacing & shape | `rounded-*` |
| `--shadow-`, `--inset-shadow-`, `--drop-shadow-`, `--text-shadow-` | Spacing & shape | `shadow-*`… |
| `--blur-` | Spacing & shape | `blur-*` |
| `--ease-`, `--animate-`, `--duration-` | Motion | `ease-*`, `animate-*` |
| `--breakpoint-`, `--container-` | Breakpoints | `sm:`, `@container` sizes |

A `--text-<name>--line-height` companion is shown with its size; other `--text-*--*` companions are not listed separately.

### Semantic variables with a theme mapping

The recommended shape: semantic names in `:root`, dark overrides, and `@theme inline` pointing Tailwind at them.

```css
:root {
  /* @group Surfaces */
  /* Page background */
  --bg: #edeff2;
  /* Cards, panels, inputs */
  --surface: #ffffff;

  /* @group Text */
  --ink: #1b1f24;
  --muted: #59626d;

  /* @group Action */
  --action: #a55700; /* Links, focus rings, the one thing to click */
  color-scheme: light;
}

:root[data-theme="dark"] {
  --bg: #141619;
  --surface: #1b1e22;
  --ink: #e6e8eb;
  --muted: #8a929c;
  --action: #f0a040;
  color-scheme: dark;
}

@theme inline {
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-action: var(--action);

  --text-body: 14px;
  --text-body--line-height: 20px;

  --radius-control: 6px;
  --shadow-pop: 0 16px 40px rgb(27 31 36 / 0.16);
}
```

How the viewer presents this:

- An `@theme` variable whose whole value is `var(--x)`, where `--x` is a light-scope variable, is shown as `--x` with its light and dark values and its utility key (`--color-ink: var(--ink)` lists `--ink`, utility `ink`, so `bg-ink`, `text-ink`).
- Other `@theme` variables are listed under their own name, with values resolved through `var()` chains.
- Light-scope variables no `@theme` entry points at are listed too, with a kind guessed from the value and name (colors, shadows, radii, easings, durations, font stacks), in a "Variables" group when nothing fits.
- A dark value is shown only when it differs from the light one.

### Groups and descriptions

- `/* @group Name */` starts a group; it applies to the following declarations in the same block until the next marker. The group of a `:root` variable wins over its `@theme` entry.
- A comment on the line directly above a declaration describes it; a comment after a declaration on the same line does too.
- Without markers, tokens fall into default groups by kind: Colors, Font families, Type scale, Font weights, Line heights, Letter spacing, Spacing, Radii, Shadows, Blur, Easing, Animations, Durations, Breakpoints.

### Base styles

Page defaults belong in `tokens.css` too, so every screen starts right:

```css
@layer base {
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    line-height: var(--text-body--line-height);
  }
}
```

`@utility`, `@layer components` and `@keyframes` work as in any Tailwind v4 stylesheet.

### What not to put in tokens.css

- `@import "tailwindcss"`: already imported before `tokens.css`.
- `@custom-variant dark`: already bound to `[data-theme="dark"]`.
- `@source`: every file in `.design` is scanned; add project folders through `sources` in `.design/design.json`.
- `@plugin` or `@config` naming a file in `.design`: refused, since Tailwind would run it in Node and `design pull` may have brought it. Name an installed package or a file in the app's own source.

## Fonts

- Hosted: add the stylesheet URL to `system.json` `fonts`, then name the family in `--font-*`.
- Self-hosted: put files in `assets/fonts/` and declare them in `tokens.css` with URLs relative to `tokens.css`:

  ```css
  @font-face {
    font-family: "Brand Sans";
    src: url("./assets/fonts/BrandSans-Variable.woff2") format("woff2");
    font-weight: 100 900;
    font-display: swap;
  }
  ```

- Always give a fallback stack (`"Brand Sans", system-ui, sans-serif`).

The typography page renders families, the type scale and weights inside a frame that loads the system stylesheet, so it shows exactly what screens get.

## components/

Real components, imported by screens and specimens as `@system/components/<path>`:

```tsx
// .design/system/components/button.tsx
import type { ButtonHTMLAttributes } from 'react'

export type ButtonKind = 'primary' | 'secondary' | 'ghost'

const KIND: Record<ButtonKind, string> = {
  primary: 'bg-action text-surface hover:opacity-90',
  secondary: 'border border-rule-strong bg-surface text-ink hover:bg-soft',
  ghost: 'text-ink hover:bg-soft',
}

export function Button({ kind = 'secondary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind }) {
  return <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-[13.5px] font-medium ${KIND[kind]} ${className}`} {...rest} />
}
```

- Any file type works; React components (`.tsx`, `.jsx`) are what module screens can render.
- Components may import `react`, `motion/react`, `lucide-react`, `clsx`, `tailwind-merge`, other components, and project packages.
- Folders are fine: `components/menu/index.tsx` is imported as `@system/components/menu`.

## specimens/

One `.tsx`, `.jsx` or `.html` file per component page. The file name is the page id (`specimens/text-field.tsx` → `text-field`). A leading doc comment holds the metadata:

```tsx
/**
 * @title Button
 * @group Actions
 * @status stable
 * @description Primary for the one main action of a view, secondary for the rest,
 * ghost inside toolbars and table rows.
 * @source ../components/button.tsx
 */
import { Button } from '@system/components/button'

export default function ButtonSpecimen() {
  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary">Save changes</Button>
        <Button>Cancel</Button>
        <Button kind="ghost">More</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" disabled>Save changes</Button>
        <Button disabled>Cancel</Button>
      </div>
    </div>
  )
}
```

| Tag | Meaning |
| --- | --- |
| `@title` | Page title. Default: the file name, humanized. |
| `@group` | Sidebar group (Actions, Inputs, Navigation, Feedback, Data display…). Default `Components`. |
| `@description` | Usage guidance; runs over several lines until the next tag. |
| `@status` | Free text shown as a badge (`stable`, `beta`, `deprecated`). |
| `@source` | Component source shown on the Code tab, relative to the specimen; repeat the tag or separate paths with spaces or commas. Without it, a file in `components/` with the same name (or a folder of that name) is used. Only files inside the project show (and go into builds): a path out of it, or through a dot-file or dot-folder such as `.env` or `.git`, is left out with a warning. |

HTML specimens put the same tags in a leading `<!-- … -->` comment.

Specimens render with the system stylesheet at their content height, in light and dark. Show every variant, size and state with realistic labels, grouped in rows; include the awkward cases (long labels, icons only, loading, error, disabled).

## guidelines/

Markdown pages, one topic each.

```markdown
---
title: Voice and copy
order: 2
---

Sentence case everywhere. Buttons say what happens: "Send 0.5 ETH", not "Submit".
```

- Order: `order` in frontmatter, else a numeric file-name prefix (`02-voice.md`), else alphabetical after the numbered ones.
- Title: `title` in frontmatter, else the first `# Heading`, else the file name.
- The page slug is the file name without the prefix (`02-voice.md` → `voice`).

## assets/

Anything under `assets/` (subfolders included) is listed on the Assets page: images (`png`, `jpg`, `gif`, `webp`, `avif`, `svg`, `ico`) with previews, font files, other files by name and size. Reference them from `tokens.css`, components and screens by relative path.

## Reusing the app directly

Two ways to make the system the product's own code instead of a copy:

- **The app's stylesheet.** Set `"stylesheet": "../../src/styles.css"` in `system.json` (relative to the system folder). It replaces the default entry entirely, so it must import Tailwind itself (resolved from the project's `node_modules`) and define its own dark handling; foss-design still adds `.design` as a Tailwind source. The viewer reads tokens from it and from the local files it `@import`s.
- **The app's components.** Alias the project's source folder in `.design/design.json` and import from it in screens and specimens; add the folder to `sources` so its classes are generated:

  ```json
  { "alias": { "@/": "src/" }, "sources": ["src"] }
  ```

  Restart the viewer (`design preview --restart`) after changing `alias`.

Mirrored copies are easier to reshape in design explorations; direct reuse guarantees zero drift. Pick per project and say which one you used.

## Checks

- `design check --render` reports `system.json` and `canvas.json` problems, missing `@source` files, and loads every specimen in Chrome for runtime errors.
- `design shot @system` screenshots every specimen and the typography page; `design shot @system/<component>` one specimen (`--theme dark` for the dark variant).
- The viewer: `/system` overview, colors, typography, spacing and shape, motion, components, guidelines, assets.
