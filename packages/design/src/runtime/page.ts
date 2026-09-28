/**
 * What `design page` puts into every HTML file of a page it publishes. A page is plain HTML in a
 * frame of foss-design Cloud (its `/a/` link, or the page open in its project), and the frame has
 * no popups while other sites refuse to be framed: links to them go to the app, which opens them
 * in a new tab. Links to the page's own files move the frame, as on a site. Where the pointer is
 * goes to the app once it asks, so its corner plate shows while the pointer is in that corner.
 */
;(() => {
  if (window.parent === window) return
  const post = (message: Record<string, unknown>) =>
    window.parent.postMessage({ source: 'design-runtime', key: 'page', ...message }, '*')

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return
    const link = (event.target as Element | null)?.closest?.('a[href], area[href]') as HTMLAnchorElement | null
    if (!link || link.hasAttribute('download')) return
    const target = new URL(link.href, location.href)
    if (target.origin === location.origin) {
      // Another file of the page: a new window would be blocked, so the frame goes there.
      if (link.target && link.target !== '_self') {
        event.preventDefault()
        location.assign(target.href)
      }
      return
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:' && target.protocol !== 'mailto:') return
    event.preventDefault()
    post({ type: 'link', href: target.href, path: null, form: false, raw: link.getAttribute('href') ?? '' })
  }
  window.addEventListener('click', onClick)
  window.addEventListener('auxclick', onClick)
  // Forms post nowhere from a page (the cloud's policy stops them); the app says so.
  window.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement
    if (event.defaultPrevented || form.method === 'dialog') return
    event.preventDefault()
    const action = form.getAttribute('action') ?? ''
    post({
      type: 'link',
      href: new URL(action || location.href, location.href).href,
      path: null,
      form: true,
      raw: action,
    })
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) post({ type: 'keydown', code: 'Escape' })
  })

  let asked = false
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { source?: unknown; type?: unknown } | null
    if (data?.source === 'design-viewer' && event.source === window.parent && data.type === 'pointer') asked = true
  })
  // Moves go out at most once a frame; presses and leaving right away.
  let moved: { x: number; y: number } | null = null
  const pointer = (x: number, y: number, down: boolean) => {
    if (!asked) return
    if (down || x < 0) {
      post({ type: 'pointer', x, y, down })
      return
    }
    if (!moved)
      requestAnimationFrame(() => {
        if (moved) post({ type: 'pointer', x: moved.x, y: moved.y, down: false })
        moved = null
      })
    moved = { x, y }
  }
  window.addEventListener('pointermove', (event) => pointer(event.clientX, event.clientY, false), {
    capture: true,
    passive: true,
  })
  window.addEventListener('pointerdown', (event) => pointer(event.clientX, event.clientY, true), true)
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) {
      moved = null
      pointer(-1, -1, false)
    }
  })
})()
