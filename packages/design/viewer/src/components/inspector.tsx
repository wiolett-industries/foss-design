import type { Box, ColorValue, ElementInfo, RuntimeMessage, Token } from '@shared/types'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useProject, useSystem } from '../lib/api'
import { cn } from '../lib/cn'
import { copyText } from '../lib/copy'
import { listenToFrame, sendToFrame } from '../lib/frames'
import { MOD_KEY } from '../lib/platform'
import { Button, IconButton } from '../ui/button'
import { Icon } from '../ui/icon'
import { Kbd } from '../ui/text'

interface Selection {
  info: ElementInfo
  frame: HTMLIFrameElement
}

/**
 * Inspect frames: while `enabled`, every frame in `frames` highlights on hover
 * and picks on click. The inspecting runs inside each frame (see the runtime's
 * inspect.ts); this side only switches it and shows what the frames report.
 * The pick outlives `enabled` (so a quick ⌘-hold leaves the panel open) until
 * it is cleared.
 */
export function useInspection(frames: HTMLIFrameElement[], enabled: boolean, options: { onEscape(): void }) {
  const project = useProject().data
  const tokens = useSystem(!!project?.system).data?.tokens as Token[] | undefined
  const [selected, setSelected] = useState<Selection | null>(null)
  const state = useRef({ enabled, tokens, picked: null as HTMLIFrameElement | null })
  state.current = { enabled, tokens, picked: selected?.frame ?? null }
  const onEscape = useRef(options.onEscape)
  onEscape.current = options.onEscape
  const framesRef = useRef(frames)
  framesRef.current = frames
  // What each frame was last told, so a new frame going live does not restart the others.
  const told = useRef(new Map<HTMLIFrameElement, { on: boolean; tokens?: Token[] }>())

  const tell = (frame: HTMLIFrameElement, force = false) => {
    const { enabled: on, tokens: list } = state.current
    const last = told.current.get(frame)
    if (!force && last?.on === on && last.tokens === list) return
    told.current.set(frame, { on, tokens: list })
    sendToFrame(frame, { type: 'inspect', on, tokens: on ? (list ?? []) : undefined })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: tell reads the latest state through a ref
  useEffect(() => {
    for (const frame of frames) tell(frame)
    for (const frame of told.current.keys()) if (!frames.includes(frame)) told.current.delete(frame)
  }, [frames, enabled, tokens])

  // biome-ignore lint/correctness/useExhaustiveDependencies: tell reads the latest state through a ref
  useEffect(() => {
    const offs = frames.map((frame) =>
      listenToFrame(frame, (message: RuntimeMessage) => {
        // A frame that (re)loaded starts with inspecting off.
        if (message.type === 'ready') {
          if (state.current.enabled) tell(frame, true)
          else told.current.set(frame, { on: false })
        } else if (message.type === 'inspect') {
          // A pick comes from a frame asked to inspect; after that, the frame holding it refreshes it.
          if (message.info && (state.current.enabled || state.current.picked === frame)) {
            // One pick across all frames: clear the others.
            for (const other of framesRef.current)
              if (other !== frame) sendToFrame(other, { type: 'inspect-select', ref: null })
            setSelected({ info: message.info, frame })
          } else setSelected((current) => (current?.frame === frame ? null : current))
        } else if (message.type === 'inspect-escape') onEscape.current()
      }),
    )
    return () => {
      for (const off of offs) off()
    }
  }, [frames])

  // A frame that left (scrolled away, unmounted) takes its pick with it.
  const frame = selected && frames.includes(selected.frame) ? selected.frame : null
  return {
    info: frame ? selected!.info : null,
    frame,
    /** Pick another element in the same frame by its ref, or clear the pick. */
    select(ref: number | null) {
      if (ref === null) {
        for (const each of framesRef.current) sendToFrame(each, { type: 'inspect-select', ref: null })
        setSelected(null)
      } else if (selected) sendToFrame(selected.frame, { type: 'inspect-select', ref })
    },
  }
}

/**
 * True while ⌘ or Ctrl is held on its own, in the viewer or inside any of
 * `frames`. A modifier used for a shortcut (⌘K, ⌘C) does not count.
 */
export function useModifierHold(frames: HTMLIFrameElement[]): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const isModifier = (key: string) => key === 'Meta' || key === 'Control'
    let down = false
    let combo = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      down = false
      clearTimeout(timer)
      setHeld(false)
    }
    const press = (key: string) => {
      if (isModifier(key)) {
        if (down) return
        down = true
        combo = false
        timer = setTimeout(() => {
          if (down && !combo) setHeld(true)
        }, 150)
      } else if (down) {
        combo = true
        clearTimeout(timer)
        setHeld(false)
      }
    }
    const onDown = (event: KeyboardEvent) => press(event.key)
    const onUp = (event: KeyboardEvent) => {
      if (isModifier(event.key)) release()
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', release)
    // Keys pressed inside a frame arrive from its runtime.
    const offs = frames.map((frame) =>
      listenToFrame(frame, (message: RuntimeMessage) => {
        if (message.type === 'key') {
          if (message.down) press(message.name)
          else if (isModifier(message.name)) release()
        } else if (message.type === 'blur') release()
      }),
    )
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', release)
      for (const off of offs) off()
      clearTimeout(timer)
    }
  }, [frames])
  return held
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-rule pb-2 first:border-t-0">
      <div className="flex h-9 items-center justify-between px-4 text-[12px] font-medium text-muted">
        {title}
        {right}
      </div>
      {children}
    </section>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[92px_minmax(0,1fr)] items-center gap-x-3 px-4 py-0.5 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 text-ink">{children}</div>
    </div>
  )
}

function TokenChip({ name }: { name?: string }) {
  if (!name) return null
  return (
    <button
      type="button"
      onClick={() => void copyText(`var(${name})`, 'Token copied')}
      title="Copy var()"
      className="shrink-0 cursor-pointer truncate rounded-[4px] border-0 bg-action-soft px-1.5 py-px font-mono text-[11px] text-action"
    >
      {name}
    </button>
  )
}

function Value({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="min-w-0 truncate font-mono text-[12px]" title={title}>
      {children}
    </span>
  )
}

function ColorLine({ label, color }: { label: string; color: ColorValue }) {
  return (
    <Line label={label}>
      <span
        className="size-3.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
        style={{ background: color.css }}
      />
      <Value title={color.css}>{color.value}</Value>
      <TokenChip name={color.token} />
    </Line>
  )
}

const dash = (value: number) => (value ? String(value) : '–')

function Layer({
  label,
  values,
  className,
  children,
}: {
  label: string
  values: Box
  className: string
  children: ReactNode
}) {
  const [top, right, bottom, left] = values
  return (
    <div
      className={cn(
        'relative grid grid-cols-[28px_minmax(0,1fr)_28px] grid-rows-[20px_auto_20px] rounded-[4px]',
        className,
      )}
    >
      <span className="absolute top-1 left-1.5 text-[9.5px] tracking-wide text-muted uppercase">{label}</span>
      <span className="col-start-2 self-center text-center">{dash(top)}</span>
      <span className="row-start-2 self-center text-center">{dash(left)}</span>
      <div className="row-start-2 col-start-2">{children}</div>
      <span className="row-start-2 col-start-3 self-center text-center">{dash(right)}</span>
      <span className="row-start-3 col-start-2 self-center text-center">{dash(bottom)}</span>
    </div>
  )
}

function BoxModel({ info }: { info: ElementInfo }) {
  const content = {
    w: Math.max(0, info.rect.w - info.border[1] - info.border[3] - info.padding[1] - info.padding[3]),
    h: Math.max(0, info.rect.h - info.border[0] - info.border[2] - info.padding[0] - info.padding[2]),
  }
  return (
    <div className="px-4 pt-1 pb-2 font-mono text-[11px] text-ink2">
      <Layer label="margin" values={info.margin} className="border border-dashed border-rule-strong bg-[#f6b26b]/15">
        <Layer label="border" values={info.border} className="border border-rule-strong bg-[#f9e27d]/15">
          <Layer label="padding" values={info.padding} className="border border-rule-strong bg-[#93c47d]/20">
            <div className="flex h-8 items-center justify-center rounded-[3px] border border-rule-strong bg-[#6fa8dc]/25 text-ink">
              {Math.round(content.w * 100) / 100} × {Math.round(content.h * 100) / 100}
            </div>
          </Layer>
        </Layer>
      </Layer>
    </div>
  )
}

function Crumbs({ info, onSelect }: { info: ElementInfo; onSelect(ref: number): void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-4 pb-2">
      {info.path.slice(-4).map((crumb, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ancestors are positional
        <span key={index} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelect(crumb.ref)}
            className="cursor-pointer rounded-[4px] border-0 bg-soft2 px-1.5 py-0.5 font-mono text-[11px] text-ink2 hover:text-ink"
          >
            {crumb.label}
          </button>
          <Icon name="chevron-right" size={11} className="text-muted" />
        </span>
      ))}
      <span className="rounded-[4px] bg-action-soft px-1.5 py-0.5 font-mono text-[11px] text-action">{info.label}</span>
    </div>
  )
}

/** The right sidebar: what the selected element is and how it is styled. */
export function InspectorPanel({
  info,
  onSelect,
  onClose,
  active,
}: {
  info: ElementInfo | null
  onSelect(ref: number): void
  onClose(): void
  /** Whether a frame is being inspected right now. */
  active: boolean
}) {
  return (
    <aside data-ui className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-rule bg-surface">
      <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-rule pr-2 pl-4">
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <Icon name="pointer" size={15} className="text-action" /> Inspect
        </span>
        <IconButton icon="x" label="Close inspector (I)" onClick={onClose} />
      </div>
      {!info ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Icon name="pointer" size={22} className="text-muted" />
          <span className="text-[13.5px] text-ink2">
            {active ? 'Click an element in any screen.' : `Hold ${MOD_KEY} to highlight, click to inspect.`}
          </span>
          <span className="text-[12.5px] leading-[1.5] text-muted">
            Hover shows margin, padding and content. Clicks go to the inspector, not the screen.
          </span>
          <span className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
            <Kbd>I</Kbd> toggle · hold <Kbd>{MOD_KEY}</Kbd> · <Kbd>esc</Kbd> clear
          </span>
        </div>
      ) : (
        <div className="min-h-0 grow overflow-y-auto">
          <Section title="Element">
            <div className="flex flex-col gap-1 px-4 pb-2">
              <div className="flex min-w-0 items-baseline gap-1.5">
                {info.component?.owners[0] ? (
                  <>
                    <span className="truncate font-mono text-[14px] font-medium text-ink">
                      &lt;{info.component.owners[0]}&gt;
                    </span>
                    <span className="truncate font-mono text-[12px] text-muted">{info.tag}</span>
                  </>
                ) : (
                  <span className="truncate font-mono text-[14px] font-medium text-ink">{info.label}</span>
                )}
              </div>
              {info.component && info.component.owners.length > 1 ? (
                <span className="truncate text-[12px] text-muted">in {info.component.owners.slice(1).join(' ← ')}</span>
              ) : null}
              {info.component?.file ? (
                <button
                  type="button"
                  onClick={() => void copyText(info.component!.file!, 'Path copied')}
                  className="w-fit max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-[11.5px] text-muted hover:text-ink2"
                  title="Copy path"
                >
                  {info.component.file}
                </button>
              ) : null}
              {info.text ? <span className="line-clamp-2 text-[12.5px] text-ink2">“{info.text}”</span> : null}
            </div>
            <Crumbs info={info} onSelect={onSelect} />
          </Section>

          <Section title="Box">
            <BoxModel info={info} />
            <Line label="Size">
              <Value>
                {info.rect.w} × {info.rect.h}
              </Value>
            </Line>
            <Line label="Position">
              <Value>
                x {info.rect.x} · y {info.rect.y}
              </Value>
            </Line>
          </Section>

          {info.layout.length ? (
            <Section title="Layout">
              {info.layout.map(([label, value]) => (
                <Line key={label} label={label}>
                  <Value title={value}>{value}</Value>
                </Line>
              ))}
            </Section>
          ) : null}

          {info.typography ? (
            <Section title="Typography">
              <Line label="Font">
                <Value title={info.typography.family}>
                  {info.typography.family.split(',')[0]?.replace(/["']/g, '')}
                </Value>
                <TokenChip name={info.typography.familyToken} />
              </Line>
              <Line label="Size">
                <Value>
                  {info.typography.size} / {info.typography.lineHeight}
                </Value>
                <TokenChip name={info.typography.sizeToken} />
              </Line>
              <Line label="Weight">
                <Value>{info.typography.weight}</Value>
              </Line>
              {info.typography.letterSpacing !== 'normal' ? (
                <Line label="Tracking">
                  <Value>{info.typography.letterSpacing}</Value>
                </Line>
              ) : null}
              <ColorLine label="Color" color={info.typography.color} />
              {info.typography.align !== 'start' ? (
                <Line label="Align">
                  <Value>{info.typography.align}</Value>
                </Line>
              ) : null}
              {info.typography.transform ? (
                <Line label="Transform">
                  <Value>{info.typography.transform}</Value>
                </Line>
              ) : null}
            </Section>
          ) : null}

          {Object.values(info.appearance).some(Boolean) ? (
            <Section title="Appearance">
              {info.appearance.background ? <ColorLine label="Background" color={info.appearance.background} /> : null}
              {info.appearance.backgroundImage ? (
                <Line label="Image">
                  <Value title={info.appearance.backgroundImage}>{info.appearance.backgroundImage}</Value>
                </Line>
              ) : null}
              {info.appearance.border ? (
                <Line label="Border">
                  <span
                    className="size-3.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
                    style={{ background: info.appearance.border.color.css }}
                  />
                  <Value>
                    {info.appearance.border.width} {info.appearance.border.style} {info.appearance.border.color.value}
                  </Value>
                  <TokenChip name={info.appearance.border.color.token} />
                </Line>
              ) : null}
              {info.appearance.radius ? (
                <Line label="Radius">
                  <Value>{info.appearance.radius.value}</Value>
                  <TokenChip name={info.appearance.radius.token} />
                </Line>
              ) : null}
              {info.appearance.shadow ? (
                <Line label="Shadow">
                  <Value title={info.appearance.shadow.value}>{info.appearance.shadow.value}</Value>
                  <TokenChip name={info.appearance.shadow.token} />
                </Line>
              ) : null}
              {info.appearance.opacity ? (
                <Line label="Opacity">
                  <Value>{info.appearance.opacity}</Value>
                </Line>
              ) : null}
            </Section>
          ) : null}

          {info.classes.length ? (
            <Section
              title="Classes"
              right={
                <button
                  type="button"
                  onClick={() => void copyText(info.classes.join(' '), 'Classes copied')}
                  className="cursor-pointer border-0 bg-transparent text-[12px] text-muted hover:text-ink2"
                >
                  Copy
                </button>
              }
            >
              <div className="flex flex-wrap gap-1 px-4 pb-1">
                {info.classes.map((name) => (
                  <span key={name} className="rounded-[4px] bg-soft2 px-1.5 py-0.5 font-mono text-[11px] text-ink2">
                    {name}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          {info.attributes.length ? (
            <Section title="Attributes">
              {info.attributes.map(([name, value]) => (
                <Line key={name} label={name}>
                  <Value title={value}>{value}</Value>
                </Line>
              ))}
            </Section>
          ) : null}

          {info.children.length ? (
            <Section title={`Children · ${info.children.length}`}>
              <div className="flex flex-col px-2 pb-1">
                {info.children.map((child, index) => (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: children are positional
                    key={index}
                    type="button"
                    onClick={() => onSelect(child.ref)}
                    className="flex h-7 cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-transparent px-2 text-left font-mono text-[12px] text-ink2 hover:bg-soft2"
                  >
                    <Icon name="chevron-right" size={12} className="text-muted" />
                    <span className="truncate">{child.label}</span>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      )}
      {info ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-rule bg-soft px-4 py-2.5">
          <Button icon="copy" onClick={() => void copyText(info.css, 'CSS copied')} className="grow">
            Copy CSS
          </Button>
        </div>
      ) : null}
    </aside>
  )
}
