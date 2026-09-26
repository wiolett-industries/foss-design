/** A screen the canvas page should bring into view once it has laid out, set from outside it (⌘K). */
let pending: { canvas: string; item: string } | null = null

export function requestFocus(canvas: string, item: string) {
  pending = { canvas, item }
  window.dispatchEvent(new CustomEvent('design:focus', { detail: pending }))
}

export function takeFocus(canvas: string): string | null {
  if (!pending || pending.canvas !== canvas) return null
  const item = pending.item
  pending = null
  return item
}
