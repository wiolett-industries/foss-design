/** Starter files for `design init`, `design system init` and `design new`. */

export const TOKENS_CSS = `/*
 * Design tokens. Every screen gets Tailwind v4 with these as utilities:
 * bg-surface, text-ink, border-rule, font-sans, rounded-control, text-body…
 *
 * Light values live in :root, dark overrides in :root[data-theme="dark"],
 * and @theme inline maps them to Tailwind. A "@group Name" comment starts a
 * group in the viewer; a comment right above a token describes it.
 */

:root {
  /* @group Surfaces */
  /* Page background */
  --bg: #f4f5f7;
  /* Cards, panels and inputs */
  --surface: #ffffff;
  /* Hover fills and quiet areas */
  --soft: #eceef1;

  /* @group Text */
  --ink: #16181d;
  --ink-2: #3b4049;
  --muted: #6b7280;

  /* @group Lines */
  --rule: #dfe2e7;
  --rule-strong: #b8bec7;

  /* @group Accent */
  --accent: #2f5bea;
  --accent-ink: #ffffff;
  --accent-soft: #e6ecfd;

  /* @group Status */
  --ok: #1f7a4d;
  --ok-soft: #e3f3ea;
  --danger: #c0352b;
  --danger-soft: #fbe9e7;

  color-scheme: light;
}

:root[data-theme="dark"] {
  --bg: #111317;
  --surface: #181b20;
  --soft: #20242a;
  --ink: #e8eaed;
  --ink-2: #c4c8cf;
  --muted: #8b929c;
  --rule: #272b32;
  --rule-strong: #434952;
  --accent: #7c9bff;
  --accent-ink: #0b1020;
  --accent-soft: #1c2645;
  --ok: #5cc18d;
  --ok-soft: #16301f;
  --danger: #f07b70;
  --danger-soft: #3a1c19;
  color-scheme: dark;
}

@theme inline {
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-soft: var(--soft);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-muted: var(--muted);
  --color-rule: var(--rule);
  --color-rule-strong: var(--rule-strong);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-soft: var(--accent-soft);
  --color-ok: var(--ok);
  --color-ok-soft: var(--ok-soft);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);

  /* Captions, table meta */
  --text-caption: 12px;
  --text-caption--line-height: 16px;
  /* Default reading size */
  --text-body: 14px;
  --text-body--line-height: 20px;
  --text-title: 20px;
  --text-title--line-height: 28px;
  --text-display: 32px;
  --text-display--line-height: 40px;

  /* Buttons and inputs */
  --radius-control: 6px;
  /* Cards and panels */
  --radius-card: 10px;

  /* Menus and popovers */
  --shadow-pop: 0 12px 32px rgb(16 24 40 / 0.14);
}

@layer base {
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    line-height: var(--text-body--line-height);
  }
}
`

export const OVERVIEW_MD = `# Overview

What this product is, who it is for, and the three or four principles every screen follows.

## Principles

- **One thing per screen.** Each view has one primary action.
- **Quiet chrome.** Neutral surfaces; the accent marks what the user can act on.

## Voice

How the interface talks: sentence case, plain verbs, no exclamation marks.
`

export const BUTTON_TSX = `import type { ButtonHTMLAttributes } from 'react'

export type ButtonKind = 'primary' | 'secondary' | 'ghost'

const KIND: Record<ButtonKind, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-rule-strong bg-surface text-ink hover:bg-soft',
  ghost: 'text-ink-2 hover:bg-soft',
}

export function Button({
  kind = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind }) {
  return (
    <button
      type="button"
      className={\`inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-control px-3.5 text-body font-medium transition disabled:cursor-not-allowed disabled:opacity-45 \${KIND[kind]} \${className}\`}
      {...rest}
    />
  )
}
`

export const BUTTON_SPECIMEN_TSX = `/**
 * @title Button
 * @group Actions
 * @description One primary action per view, secondary for the rest, ghost inside toolbars.
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
        <Button kind="primary" disabled>
          Save changes
        </Button>
        <Button disabled>Cancel</Button>
      </div>
    </div>
  )
}
`

export function canvasJson(title: string): string {
  return `${JSON.stringify(
    {
      title,
      pages: [
        {
          id: 'main',
          title: 'Main',
          sections: [{ title: 'Screens', items: [{ src: 'screens/Main.tsx', device: 'desktop' }] }],
        },
      ],
    },
    null,
    2,
  )}\n`
}

export function mainScreen(canvasId: string): string {
  return `export default function Main() {
  return (
    <main className="grid min-h-screen place-items-center p-10">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">New canvas</h1>
        <p className="mt-2 text-sm opacity-70">
          Edit .design/canvas/${canvasId}/screens/Main.tsx and the canvas updates on save.
        </p>
      </div>
    </main>
  )
}
`
}
