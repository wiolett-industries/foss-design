---
name: building-design-systems
description: Create, extract, or update a design system with foss-design - design tokens (colors, type scale, spacing, radii, shadows, motion, light and dark themes), a component library with live specimens, brand foundations, style guides and usage guidelines - in the project's gitignored .design/system folder, browsable in the local viewer at /system and used by every design canvas. Use when asked to set up or document a design system, pull tokens and components out of an existing codebase, make the UI consistent, define a brand's visual foundations, or before designing screens for a product that has no design system in .design yet.
---

# Building Design Systems

A foss-design system lives in `.design/system/` and does two jobs at once: it is the **source of truth every canvas screen is styled with** (tokens become Tailwind v4 utilities, components are imported with `@system/components/...`), and it is a **browsable style guide** in the local viewer at `/system` (colors, typography, spacing and shape, motion, components with live specimens, guidelines, assets).

```
.design/system/
  system.json          name, description, web fonts, optional custom stylesheet
  tokens.css           CSS variables: light, dark, and the @theme mapping to Tailwind
  components/          real components screens import (@system/components/button)
  specimens/           one page per component, showing every variant and state
  guidelines/          Markdown pages: principles, voice, layout, patterns
  assets/              logos, icons, font files, imagery
```

Full format: [System format](references/system-format.md).

## Run the CLI

```bash
command -v design >/dev/null && D=design || D="npx -y foss-design"
```

`design` exists after `npm i -g foss-design`; `npx -y foss-design` runs the same CLI without installing.

## Workflow

1. **Set up.** No `.design` yet: `$D init`. No system yet: `$D system init` scaffolds `system.json`, a starter `tokens.css`, one guideline and a `Button` component with its specimen. `--empty` scaffolds only `system.json` and `tokens.css`. The starter is a format example: replace its values with the real ones.
2. **Extract from the codebase first.** When the project has a UI, the system mirrors it; do not invent a parallel one.
   - Tokens: Tailwind v4 `@theme` blocks and the CSS files that define them, `tailwind.config.*` theme sections, CSS custom properties, SCSS/Less variables, theme objects in TS/JS (MUI, Chakra, styled-components), design-token JSON.
   - Resolve every alias to its final value and copy values exactly: hex/oklch as written, `13.5px` stays `13.5px`, never rounded to a grid.
   - Find light and dark definitions and keep them paired under the same names.
   - Fonts: the families, weights and where they load from (`@fontsource`, Google Fonts, local files).
   - Components: the shared primitives (`components/ui`, `packages/ui`, `src/ui`): buttons, inputs, selects, menus, dialogs, tabs, tables, badges, cards, navigation.
   Say in one line what you mirrored ("from `apps/web/src/styles.css` and `src/ui/*`: IBM Plex, amber action color, 6/8/10 px radii, 32 px controls").
3. **Write `tokens.css`.** Semantic variables in `:root`, dark overrides in `:root[data-theme="dark"]`, and an `@theme inline` block mapping them to Tailwind namespaces (`--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--ease-*`…). Group them with `/* @group Name */` comments and describe non-obvious tokens with a comment on the line above. Conventions: [System format](references/system-format.md#tokenscss).
4. **Fonts.** Google Fonts or other hosted stylesheets go in `system.json` `fonts`; self-hosted families are `@font-face` rules in `tokens.css` with files in `assets/fonts/`. Map families to `--font-sans`, `--font-mono`, `--font-display` in `@theme`.
5. **Components.** Port each shared primitive into `components/` as a React component styled with the token utilities, keeping its real anatomy, sizes and states (hover, focus, disabled, loading, error). Port from the source, not from memory. When screens should use the project's actual components instead, alias the project folder in `.design/design.json` (see [System format](references/system-format.md#reusing-the-app-directly)) and document them through specimens that import them.
6. **Specimens.** One file per component in `specimens/`, opening with a doc comment (`@title`, `@group`, `@description`, `@source`) and rendering every variant, size and state side by side with realistic labels. They are the component pages of the viewer.
7. **Guidelines.** Short Markdown pages in `guidelines/`: overview and principles, voice and copy rules, layout and density, patterns (forms, empty states, errors). Number file names (`01-overview.md`) to order them. Write what the product actually does, not generic advice.
8. **Verify.** `$D check --render` validates `system.json`, the canvases, and loads every specimen in Chrome for runtime errors. To look at specimens yourself, run `$D shot @system` (every specimen and the typography page) or `$D shot @system/<component>`, add `--theme dark`, and read the PNGs. Then `$D preview` and give the user `<url>/system`.

## Designing a new system

When there is no product UI to mirror:

1. Agree the direction with the user first: references, tone, density, a color stance. When it is open, sketch 2-4 genuinely different directions as screens on a canvas (with the `designing-canvases` skill) and let the user choose.
2. Commit to a small system: 1-3 font families with fallbacks; neutral foreground and background with a subtle tone (warm, cool or neutral; whites and blacks slightly tinted); 0-2 accents defined in oklch with equal lightness and chroma; a type scale of 4-7 steps with line heights; 2-4 radii; 2-3 shadows; one easing and two or three durations.
3. Define dark values for every color from the start, check contrast (body text at least 4.5:1, large text and UI outlines 3:1) in both themes.
4. Build the handful of components the first screens need, with specimens, then grow the system as designs need more. Do not pre-build a speculative library.

## Updating a system

- Change the token, not the screens: screens use utilities, so a value change propagates to every canvas.
- Renaming a token breaks the screens that use it. Search `.design/canvas` for the utility and variable name and update them in the same change.
- Keep `components/` and specimens in step: a new variant needs its specimen row.
- Record decisions that are not visible in the tokens (when to use the accent, how destructive actions look) in a guideline.

## Pitfalls

- Do not `@import "tailwindcss"` in `tokens.css`, and do not redeclare the `dark` custom variant: foss-design imports Tailwind first and binds `dark:` to `[data-theme="dark"]` itself. The exception is a custom `stylesheet` (see the format reference), which brings its own.
- Values in `@theme inline` that are `var(--x)` references to `:root` variables are what make light and dark work; a literal value in `@theme` has no dark variant unless you also override it in the dark block.
- Only rules on `:root`, `html` or `:host` (light), and dark rules (`[data-theme="dark"]`, `.dark`, or `@media (prefers-color-scheme: dark)`) are read as tokens; variables scoped to component selectors are not listed.
- `system.json` is strict: unknown keys are errors. `name` is required.
- Specimen ids come from file names; renaming a specimen changes its URL.
- Screens only see component changes after save; nothing needs rebuilding. The viewer's `/system` pages update live.
- In a project linked to foss-design Cloud, pushing a design system change rebuilds and pushes every active canvas with it; `$D push` handles that, but the local copy must be up to date first (`$D pull`).

Reference: [System format](references/system-format.md).
