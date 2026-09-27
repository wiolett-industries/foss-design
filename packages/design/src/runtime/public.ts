/**
 * The project's public folder (design.json `public`) belongs at the site root, but a frame
 * sits under a prefix: `/_fs/` in the dev server, the unit's revision in the cloud. Vite
 * rewrites root paths in HTML and CSS; paths written in code (`<img src="/logo.png">` in JSX,
 * `fetch('/data.json')`) reach the runtime as they are, and it points them at the folder.
 */
import type { PublicFolder } from '../shared/types'

/** Attributes that load a file; `a[href]` is a link, and links are the viewer's. */
const ATTRS = ['src', 'srcset', 'poster', 'href', 'xlink:href'] as const
const LOADS_HREF = new Set(['link', 'image', 'use', 'feimage'])

export function servePublicFolder(folder: PublicFolder | undefined) {
  if (!folder?.files.length) return
  const files = new Set(folder.files)
  const base = new URL(folder.base, location.href)

  /** The public file a root path names, as a URL the frame can load; null for anything else. */
  const resolve = (value: string): string | null => {
    if (!value.startsWith('/') || value.startsWith('//')) return null
    const [, pathname = '', suffix = ''] = /^([^?#]*)(.*)$/.exec(value) ?? []
    let rel: string
    try {
      rel = decodeURIComponent(pathname.slice(1))
    } catch {
      return null
    }
    return files.has(rel) ? new URL(pathname.slice(1), base).href + suffix : null
  }
  const rewrite = (name: string, value: string): string | null => {
    if (name !== 'srcset') return resolve(value)
    let changed = false
    const next = value
      .split(',')
      .map((candidate) => {
        const [url = '', ...rest] = candidate.trim().split(/\s+/)
        const resolved = resolve(url)
        if (!resolved) return candidate
        changed = true
        return [resolved, ...rest].join(' ')
      })
      .join(', ')
    return changed ? next : null
  }
  const applies = (element: Element, name: string) =>
    name.endsWith('href') ? LOADS_HREF.has(element.localName.toLowerCase()) : true

  // Frameworks set attributes through setAttribute: rewriting there keeps the root path from ever loading.
  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    const lower = name.toLowerCase()
    const next =
      (ATTRS as readonly string[]).includes(lower) && applies(this, lower) ? rewrite(lower, String(value)) : null
    setAttribute.call(this, name, next ?? value)
  }

  // Markup (the page itself, innerHTML) and property setters come through here.
  const fix = (element: Element) => {
    for (const name of ATTRS) {
      const value = element.getAttribute(name)
      if (value === null || !applies(element, name)) continue
      const next = rewrite(name, value)
      if (next !== null) setAttribute.call(element, name, next)
    }
  }
  const fixTree = (root: Element) => {
    fix(root)
    for (const element of root.querySelectorAll('[src], [srcset], [poster], [href]')) fix(element)
  }
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') fix(record.target as Element)
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) fixTree(node as Element)
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'poster', 'href'],
  })
  if (document.documentElement) fixTree(document.documentElement)

  const fetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : null
    let path = raw
    if (raw && input instanceof URL && input.origin === location.origin) path = input.pathname + input.search
    const resolved = path ? resolve(path) : null
    return fetch(resolved ?? input, init)
  }
}
