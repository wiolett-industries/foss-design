/**
 * A forgiving HTML tokenizer for templates: it keeps elements where they are written. A browser
 * parser would move `<sc-for>` out of a `<table>`, and template tags have to stay put.
 */
export interface Element {
  type: 'element'
  tag: string
  attrs: [name: string, value: string | null][]
  children: MarkupNode[]
}
export interface Text {
  type: 'text'
  text: string
}
export type MarkupNode = Element | Text

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const RAW = new Set(['script', 'style', 'textarea', 'title'])
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y

export function parseMarkup(source: string): Element {
  const root: Element = { type: 'element', tag: '#root', attrs: [], children: [] }
  const stack: Element[] = [root]
  const top = () => stack[stack.length - 1]!
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      top().children.push({ type: 'text', text: source.slice(i) })
      break
    }
    if (lt > i) top().children.push({ type: 'text', text: source.slice(i, lt) })
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if (source[lt + 1] === '!' || source[lt + 1] === '?') {
      const end = source.indexOf('>', lt)
      i = end === -1 ? source.length : end + 1
      continue
    }
    if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt)
      const tag = source.slice(lt + 2, end === -1 ? source.length : end).trim()
      i = end === -1 ? source.length : end + 1
      // Close the nearest open element with that name; a stray end tag is dropped.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]!.tag.toLowerCase() === tag.toLowerCase()) {
          stack.length = depth
          break
        }
      }
      continue
    }
    const name = /^[A-Za-z][\w:-]*/.exec(source.slice(lt + 1))
    if (!name) {
      top().children.push({ type: 'text', text: '<' })
      i = lt + 1
      continue
    }
    const element: Element = { type: 'element', tag: name[0], attrs: [], children: [] }
    let at = lt + 1 + name[0].length
    let selfClosing = false
    for (;;) {
      while (at < source.length && /\s/.test(source[at]!)) at++
      if (at >= source.length) break
      if (source[at] === '>') {
        at++
        break
      }
      if (source.startsWith('/>', at)) {
        selfClosing = true
        at += 2
        break
      }
      ATTR.lastIndex = at
      const match = ATTR.exec(source)
      if (!match) {
        at++
        continue
      }
      element.attrs.push([match[1]!, match[2] ?? match[3] ?? match[4] ?? null])
      at = ATTR.lastIndex
    }
    top().children.push(element)
    const lower = element.tag.toLowerCase()
    if (RAW.has(lower) && !selfClosing) {
      const close = source.toLowerCase().indexOf(`</${lower}`, at)
      const end = close === -1 ? source.length : close
      element.children.push({ type: 'text', text: source.slice(at, end) })
      const gt = close === -1 ? -1 : source.indexOf('>', close)
      i = gt === -1 ? source.length : gt + 1
      continue
    }
    if (!selfClosing && !VOID.has(lower)) stack.push(element)
    i = at
  }
  return root
}

export function findElement(node: Element, test: (element: Element) => boolean): Element | null {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (test(child)) return child
    const found = findElement(child, test)
    if (found) return found
  }
  return null
}

export const attr = (element: Element, name: string): string | null | undefined =>
  element.attrs.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  thinsp: ' ',
  ensp: ' ',
  emsp: ' ',
  mdash: '—',
  ndash: '–',
  minus: '−',
  hellip: '…',
  middot: '·',
  bull: '•',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  divide: '÷',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  plusmn: '±',
  le: '≤',
  ge: '≥',
  ne: '≠',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  check: '✓',
  zwj: '‍',
  zwnj: '‌',
  shy: '­',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}
