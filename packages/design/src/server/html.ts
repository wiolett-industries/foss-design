import type { ScreenSource } from '../core/sources'
import { escapeHtml, scriptJson } from '../core/text'
import type { PublicFolder, Theme } from '../shared/types'

export interface FrameHead {
  source: ScreenSource
  /** Theme the frame opens in when canvas.json does not pin one. */
  theme: Theme
  fonts: string[]
  /** URL of the system stylesheet to link, for HTML screens. */
  systemCss?: string
  /** URL of the runtime boot module, for HTML screens. */
  boot?: string
  snapshots: boolean
  autoHeight: boolean
  /** design.json `public`, for root paths in the screen's code. */
  public?: PublicFolder
}

/** Frame config and the theme applied before first paint. */
function headTags(head: FrameHead): string {
  const { source } = head
  const config = {
    key: source.key,
    canvas: source.canvas,
    id: source.id,
    title: source.title,
    props: source.props,
    theme: source.theme,
    snapshots: head.snapshots,
    autoHeight: head.autoHeight,
    public: head.public,
  }
  const fallback = source.theme ?? head.theme
  const theme =
    `(function(){var q=new URLSearchParams(location.search).get('theme');` +
    `var t=${JSON.stringify(source.theme ?? null)}||(q==='dark'||q==='light'?q:${JSON.stringify(fallback)});` +
    `var r=document.documentElement;r.dataset.theme=t;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t})()`
  const tags = [`<script>window.__DESIGN__=${scriptJson(config)};${theme}</script>`, '<link rel="icon" href="data:,">']
  for (const href of head.fonts) tags.push(`<link rel="stylesheet" href="${escapeHtml(href)}">`)
  if (head.systemCss) tags.push(`<link rel="stylesheet" href="${escapeHtml(head.systemCss)}">`)
  if (head.boot) tags.push(`<script type="module" src="${escapeHtml(head.boot)}"></script>`)
  return tags.join('\n')
}

/** The page a module screen renders in. */
export function moduleShell(head: FrameHead, entryUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(head.source.title)}</title>
${headTags(head)}
</head>
<body>
<div id="root"></div>
<script type="module" src="${escapeHtml(entryUrl)}"></script>
</body>
</html>
`
}

/** Whether an HTML screen opted out of the design system stylesheet. */
export function optsOutOfSystem(html: string): boolean {
  return /<meta\s+name=["']design:system["']\s+content=["']off["']/i.test(html)
}

/** Put the frame config, fonts, system stylesheet and runtime at the top of an HTML screen's head. */
export function injectIntoHtml(html: string, head: FrameHead): string {
  const tags = headTags(head)
  const open = /<head(\s[^>]*)?>/i.exec(html)
  if (open) return `${html.slice(0, open.index + open[0].length)}\n${tags}\n${html.slice(open.index + open[0].length)}`
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(html)
  if (htmlOpen)
    return (
      html.slice(0, htmlOpen.index + htmlOpen[0].length) +
      `\n<head>\n${tags}\n</head>\n` +
      html.slice(htmlOpen.index + htmlOpen[0].length)
    )
  return `<!doctype html>\n<html><head>\n${tags}\n</head><body>\n${html}\n</body></html>`
}
