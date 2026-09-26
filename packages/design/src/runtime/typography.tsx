import { useEffect, useSyncExternalStore } from 'react'

interface TokenValue {
  raw: string
  value: string
}

interface TypeToken {
  name: string
  kind: string
  utility?: string
  light?: TokenValue
  lineHeight?: string
  description?: string
}

const PANGRAMS = [
  'The quick brown fox jumps over the lazy dog',
  'Съешь же ещё этих мягких французских булок, да выпей чаю',
]

function useDark(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const observer = new MutationObserver(listener)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
      return () => observer.disconnect()
    },
    () => document.documentElement.dataset.theme === 'dark',
    () => false,
  )
}

const label = { font: '500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace' } as const

/** Font families, the type scale and weights, set in the design system's own stylesheet. */
export function TypographySpecimen({ tokens = [], sample }: { tokens?: TypeToken[]; sample?: string }) {
  const dark = useDark()
  // Set on the system's own page: its background and text color, so the theme toggle shows both.
  // A system that paints neither gets the browser's canvas colors for the theme.
  useEffect(() => {
    void dark
    const body = document.body
    body.style.removeProperty('background')
    body.style.removeProperty('color')
    const clear = (color: string) => color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color)
    if (
      clear(getComputedStyle(body).backgroundColor) &&
      clear(getComputedStyle(document.documentElement).backgroundColor)
    ) {
      body.style.background = 'Canvas'
      body.style.color = 'CanvasText'
    }
  }, [dark])
  const ink = 'currentColor'
  const muted = 'color-mix(in srgb, currentColor 58%, transparent)'
  const rule = 'color-mix(in srgb, currentColor 14%, transparent)'
  const fonts = tokens.filter((token) => token.kind === 'font')
  const sizes = tokens.filter((token) => token.kind === 'text')
  const weights = tokens.filter((token) => token.kind === 'weight')
  const text = sample ?? PANGRAMS[0]!
  const heading = (title: string) => (
    <div
      style={{ ...label, color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '20px 24px 8px' }}
    >
      {title}
    </div>
  )
  const row = { borderTop: `1px solid ${rule}`, padding: '16px 24px' } as const
  const meta = (token: TypeToken, extra?: string) => (
    <div style={{ ...label, color: muted, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
      <span style={{ color: ink }}>{token.name}</span>
      {token.utility !== undefined ? <span>{token.utility}</span> : null}
      <span>{extra ?? token.light?.raw}</span>
    </div>
  )

  return (
    <div style={{ paddingBottom: 12 }}>
      {fonts.length ? heading('Families') : null}
      {fonts.map((token) => (
        <div key={token.name} style={row}>
          {meta(token, token.light?.value)}
          <div style={{ fontFamily: token.light?.value, display: 'flex', alignItems: 'baseline', gap: 24 }}>
            <span style={{ fontSize: 56, lineHeight: 1 }}>Aa</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 18, lineHeight: 1.4 }}>
              {(sample ? [sample] : PANGRAMS).map((line) => (
                <span key={line}>{line}</span>
              ))}
              <span style={{ color: muted, fontSize: 15 }}>0123456789 — ¶ & @ ₽ € $ %</span>
            </span>
          </div>
        </div>
      ))}
      {sizes.length ? heading('Type scale') : null}
      {sizes.map((token) => (
        <div key={token.name} style={row}>
          {meta(token, [token.light?.value, token.lineHeight].filter(Boolean).join(' / '))}
          <div
            style={{
              fontSize: token.light?.value,
              lineHeight: token.lineHeight,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {text}
          </div>
        </div>
      ))}
      {weights.length ? heading('Weights') : null}
      {weights.map((token) => (
        <div key={token.name} style={{ ...row, display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div style={{ fontWeight: token.light?.value as never, fontSize: 22, flex: 1 }}>{text}</div>
          <div style={{ ...label, color: muted }}>
            {token.name} {token.light?.value}
          </div>
        </div>
      ))}
    </div>
  )
}
