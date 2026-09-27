import type { Theme } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { frameSrc, listenToFrame, scrollAround, sendTheme } from '../lib/frames'
import { useViewer } from '../lib/viewer'
import { Icon } from '../ui/icon'

/**
 * A frame that grows to its content: system specimens and the typography page.
 * The theme is sent to the running frame; changing it does not reload it.
 */
export function AutoFrame({
  src,
  theme,
  title,
  minHeight = 120,
  width,
  className,
}: {
  src: string
  theme: Theme
  title: string
  minHeight?: number
  width?: number
  className?: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const { frameSandbox } = useViewer()
  const [initial] = useState(() => ({ src, theme }))
  const url = frameSrc(src, initial.src === src ? initial.theme : theme)
  const [height, setHeight] = useState(minHeight)
  const [ready, setReady] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the iframe remounts for a new source
  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    setReady(false)
    setErrors([])
    return listenToFrame(frame, (message) => {
      if (message.type === 'size') setHeight(Math.max(minHeight, message.height))
      else if (message.type === 'ready') setReady(true)
      else if (message.type === 'error')
        setErrors((list) => (list.includes(message.message) ? list : [...list, message.message]))
      else if (message.type === 'updated') setErrors([])
      else if (message.type === 'wheel' && !message.zoom) scrollAround(frame, message)
    })
  }, [minHeight, url])

  useEffect(() => {
    sendTheme(ref.current, theme)
  }, [theme])

  return (
    <div className={cn('relative', className)} style={{ width }}>
      {errors.length ? (
        <div className="flex items-start gap-2 border-b border-rule bg-danger-soft px-4 py-2.5 text-[12.5px] text-danger-text">
          <Icon name="alert" size={15} className="mt-px" />
          <div className="min-w-0 font-mono break-words">{errors.join('\n')}</div>
        </div>
      ) : null}
      <iframe
        ref={ref}
        key={url}
        src={url}
        title={title}
        sandbox={frameSandbox}
        className={cn('block w-full border-0 transition-opacity duration-150', ready ? 'opacity-100' : 'opacity-0')}
        style={{ height, colorScheme: theme }}
        onLoad={() => sendTheme(ref.current, theme)}
      />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted">
          <Icon name="loader" size={18} />
        </div>
      ) : null}
    </div>
  )
}
