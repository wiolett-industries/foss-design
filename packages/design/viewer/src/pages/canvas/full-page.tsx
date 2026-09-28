import type { RuntimeMessage, ScreenItem, Theme, UrlItem } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useRouter } from 'wouter'
import { CornerPlate } from '../../components/corner-plate'
import { useCanvas } from '../../lib/api'
import { absoluteUrl, followLink, frameSrc, listenToFrame, sendTheme } from '../../lib/frames'
import { useTheme } from '../../lib/theme'
import { useViewer } from '../../lib/viewer'
import { Icon } from '../../ui/icon'
import { Kbd } from '../../ui/text'
import { NotFound } from '../not-found'

type Frame = ScreenItem | UrlItem

/** The full-window page of one screen, relative to the viewer's base. */
export const fullHref = (canvas: string, item: string, theme: Theme) =>
  `/c/${encodeURIComponent(canvas)}/full/${encodeURIComponent(item)}?theme=${theme}`

/**
 * "Open in a new tab" for a screen. A sandboxed viewer serves screens to its frames only, so the
 * tab gets the full-window page of the viewer; otherwise the screen's own URL.
 */
export function useOpenUrl(canvasId: string, item: Frame | undefined, theme: Theme): string | null {
  const { frameSandbox } = useViewer()
  const { base } = useRouter()
  if (!item) return null
  if (item.kind === 'url') return item.url
  if (!frameSandbox) return absoluteUrl(frameSrc(item.url, item.theme ?? theme))
  return absoluteUrl(`${base}${fullHref(canvasId, item.id, item.theme ?? theme)}`)
}

/** `/c/:canvas/full/:item`: one screen filling the window, a way out in the top-right corner and on Esc. */
export function FullPage({ canvasId, itemId }: { canvasId: string; itemId: string }) {
  const { data: canvas, error, isLoading } = useCanvas(canvasId)
  const [, navigate] = useLocation()
  const { frameSandbox, slots } = useViewer()
  const appTheme = useTheme()
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null)
  const setFrame = useCallback((el: HTMLIFrameElement | null) => {
    frame.current = el
    setFrameEl(el)
  }, [])
  const param = new URLSearchParams(window.location.search).get('theme')
  const items: Frame[] = canvas
    ? canvas.pages.flatMap((page) =>
        page.sections.flatMap((section) =>
          section.items.filter((item): item is Frame => item.kind === 'screen' || item.kind === 'url'),
        ),
      )
    : []
  const item = items.find((entry) => entry.id === itemId)
  const theme: Theme =
    (item?.kind === 'screen' ? item.theme : undefined) ??
    (param === 'light' || param === 'dark' ? param : (canvas?.theme ?? appTheme))
  const url = item ? (item.kind === 'screen' ? frameSrc(item.url, theme) : item.url) : ''
  const back = `/c/${encodeURIComponent(canvasId)}`

  useEffect(() => {
    if (item) document.title = `${item.title} · ${canvas?.title ?? ''}`
  }, [item, canvas?.title])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(back)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, back])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the iframe remounts for a new source
  useEffect(() => {
    const el = frame.current
    if (!el || item?.kind !== 'screen') return
    return listenToFrame(el, (message: RuntimeMessage) => {
      if (message.type === 'keydown' && message.code === 'Escape') navigate(back)
      else if (message.type === 'go') {
        const id = message.target.includes('/') ? message.target.split('/')[1]! : message.target
        if (items.some((entry) => entry.id === id)) navigate(fullHref(canvasId, id, theme), { replace: true })
      } else if (message.type === 'link' && canvas) {
        followLink(message, canvas, (id) => navigate(fullHref(canvasId, id, theme), { replace: true }), itemId)
      }
    })
  }, [url, item?.kind])

  if (error) return <NotFound title="Canvas not found" text={(error as Error).message} />
  if (isLoading || !canvas) return <div className="h-dvh bg-surface" />
  if (!item) return <NotFound title="Screen not found" text={`No screen "${itemId}" on this canvas.`} />

  return (
    <div className="fixed inset-0 bg-surface">
      <iframe
        ref={setFrame}
        key={`${item.id}:${item.kind === 'screen' ? item.rev : item.url}`}
        src={url}
        title={item.title}
        allow="clipboard-read; clipboard-write; fullscreen"
        sandbox={frameSandbox}
        className="block h-full w-full border-0"
        style={{ colorScheme: theme }}
        onLoad={() => item.kind === 'screen' && sendTheme(frame.current, theme)}
      />
      <CornerPlate frame={frameEl} note={slots.fullPlate?.note} badge={slots.fullPlate?.badge}>
        <Link
          href={back}
          className="flex h-8 min-w-0 items-center gap-2 rounded-[6px] px-2 text-[12.5px] text-ink2 no-underline hover:bg-soft2 hover:text-ink"
        >
          <Icon name="x" size={14} />
          <span className="truncate">Back to {canvas.title}</span>
          <Kbd>esc</Kbd>
        </Link>
        {slots.fullPlate?.actions}
      </CornerPlate>
    </div>
  )
}
