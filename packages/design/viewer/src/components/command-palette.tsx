import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { useCanvas, useProject, useSystem } from '../lib/api'
import { cn } from '../lib/cn'
import { requestFocus } from '../lib/focus'
import { setThemePref } from '../lib/theme'
import { useViewer } from '../lib/viewer'
import { Icon, type IconName } from '../ui/icon'
import { Kbd } from '../ui/text'

type Group = 'canvas' | 'canvases' | 'system' | 'actions'

const GROUP_TITLE: Record<Group, string> = {
  canvas: 'This canvas',
  canvases: 'Canvases',
  system: 'Design system',
  actions: 'Actions',
}

interface Command {
  id: string
  group: Group
  label: string
  icon: IconName
  hint?: ReactNode
  keywords?: string
  searchOnly?: boolean
  run: () => void
}

function currentCanvas(location: string): string | null {
  const match = /^\/c\/([^/]+)/.exec(location)
  return match ? decodeURIComponent(match[1]!) : null
}

function Palette({ onClose }: { onClose: () => void }) {
  const [location, navigate] = useLocation()
  // A single canvas: its pages and screens, nothing of the rest of the project.
  const scope = useViewer().scope
  const project = useProject().data
  const canvasId = scope?.canvas ?? currentCanvas(location)
  const canvas = useCanvas(canvasId ?? '', !!canvasId).data
  const system = useSystem(!!project?.system).data
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const go = (fn: () => void) => () => {
    onClose()
    fn()
  }

  const commands: Command[] = []
  if (canvas) {
    for (const page of canvas.pages) {
      commands.push({
        id: `page:${page.id}`,
        group: 'canvas',
        label: page.title,
        icon: 'file',
        hint: 'Page',
        run: go(() => navigate(`/c/${encodeURIComponent(canvas.id)}/p/${encodeURIComponent(page.id)}`)),
      })
      for (const section of page.sections) {
        for (const item of section.items) {
          if (item.kind !== 'screen' && item.kind !== 'url') continue
          commands.push({
            id: `item:${page.id}:${item.id}`,
            group: 'canvas',
            label: item.title,
            icon: item.kind === 'url' ? 'globe' : 'monitor',
            hint: section.title ? `${page.title} · ${section.title}` : page.title,
            keywords: `${item.id} ${section.title ?? ''}`,
            searchOnly: true,
            run: go(() => {
              navigate(`/c/${encodeURIComponent(canvas.id)}/p/${encodeURIComponent(page.id)}`)
              requestFocus(canvas.id, item.id)
            }),
          })
        }
      }
    }
  }
  for (const summary of project?.canvases ?? []) {
    if (summary.id === canvasId) continue
    commands.push({
      id: `canvas:${summary.id}`,
      group: 'canvases',
      label: summary.title,
      icon: 'canvas',
      hint: `${summary.screens} screens`,
      keywords: summary.id,
      run: go(() => navigate(`/c/${encodeURIComponent(summary.id)}`)),
    })
  }
  if (project?.system) {
    const sys: [string, string, IconName][] = [
      ['Overview', '/system', 'book'],
      ['Colors', '/system/colors', 'palette'],
      ['Typography', '/system/typography', 'type'],
      ['Spacing & shape', '/system/shape', 'shape'],
    ]
    for (const [label, to, icon] of sys)
      commands.push({ id: `sys:${to}`, group: 'system', label, icon, run: go(() => navigate(to)) })
    for (const component of system?.components ?? [])
      commands.push({
        id: `component:${component.id}`,
        group: 'system',
        label: component.title,
        icon: 'component',
        hint: component.group,
        searchOnly: true,
        run: go(() => navigate(`/system/components/${encodeURIComponent(component.id)}`)),
      })
    for (const guide of system?.guidelines ?? [])
      commands.push({
        id: `guide:${guide.slug}`,
        group: 'system',
        label: guide.title,
        icon: 'book',
        hint: 'Guideline',
        searchOnly: true,
        run: go(() => navigate(`/system/guidelines/${encodeURIComponent(guide.slug)}`)),
      })
  }
  if (!scope)
    commands.push({ id: 'home', group: 'actions', label: 'All canvases', icon: 'home', run: go(() => navigate('/')) })
  commands.push(
    {
      id: 'light',
      group: 'actions',
      label: 'Light appearance',
      icon: 'sun',
      searchOnly: true,
      run: go(() => setThemePref('light')),
    },
    {
      id: 'dark',
      group: 'actions',
      label: 'Dark appearance',
      icon: 'moon',
      searchOnly: true,
      run: go(() => setThemePref('dark')),
    },
    {
      id: 'system-theme',
      group: 'actions',
      label: 'System appearance',
      icon: 'monitor',
      searchOnly: true,
      run: go(() => setThemePref('system')),
    },
  )

  const q = query.trim().toLowerCase()
  const matched = commands.filter((c) =>
    q
      ? `${c.label} ${c.keywords ?? ''} ${typeof c.hint === 'string' ? c.hint : ''}`.toLowerCase().includes(q)
      : !c.searchOnly,
  )
  const order: Group[] = ['canvas', 'canvases', 'system', 'actions']
  const groups = order
    .map((group) => ({ group, items: matched.filter((c) => c.group === group) }))
    .filter((g) => g.items.length)
  const flat = groups.flatMap((g) => g.items)
  const selected = Math.min(active, Math.max(flat.length - 1, 0))

  let index = -1
  return (
    <>
      <Dialog.Title className="sr-only">Search and jump</Dialog.Title>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-rule px-4">
        <Icon name="search" size={16} className="text-muted" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((selected + 1) % Math.max(flat.length, 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((selected - 1 + flat.length) % Math.max(flat.length, 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              flat[selected]?.run()
            }
          }}
          placeholder="Canvases, screens, components…"
          aria-label="Search and jump"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 grow border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        />
        <Kbd>esc</Kbd>
      </div>
      <div id="palette-list" role="listbox" className="min-h-0 grow overflow-y-auto py-1.5">
        {groups.length ? (
          groups.map(({ group, items }) => (
            <div key={group} role="presentation">
              <div className="px-4 pt-2.5 pb-1 text-[12px] text-muted">{GROUP_TITLE[group]}</div>
              {items.map((c) => {
                index += 1
                const i = index
                const on = i === selected
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={on}
                    ref={on ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                    onMouseMove={() => (on ? undefined : setActive(i))}
                    onClick={c.run}
                    className={cn(
                      'flex h-10 w-full cursor-pointer items-center gap-3 border-0 px-4 text-left text-[13.5px] text-ink',
                      on ? 'bg-soft' : 'bg-transparent',
                    )}
                  >
                    <span className="flex w-5 shrink-0 justify-center text-ink2">
                      <Icon name={c.icon} size={16} />
                    </span>
                    <span className="min-w-0 grow truncate">{c.label}</span>
                    {c.hint ? (
                      <span className="flex shrink-0 items-center text-[12.5px] text-muted">{c.hint}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))
        ) : (
          <div className="px-6 py-10 text-center text-[13px] text-muted">Nothing matches.</div>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center gap-4 border-t border-rule bg-soft px-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          open
        </span>
      </div>
    </>
  )
}

/** ⌘K: jump to canvases, pages, screens and system pages. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const toggle = () => setOpen((value) => !value)
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('design:palette', toggle)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('design:palette', toggle)
    }
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="fixed inset-0 z-50 flex items-start justify-center bg-overlay p-6 pt-[12vh]"
              >
                <Dialog.Content asChild forceMount aria-describedby={undefined}>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                    transition={{ type: 'spring', stiffness: 560, damping: 40 }}
                    className="flex max-h-[min(560px,76vh)] w-[560px] max-w-full flex-col overflow-hidden rounded-[12px] border border-rule bg-surface shadow-pop outline-none"
                  >
                    <Palette onClose={() => setOpen(false)} />
                  </motion.div>
                </Dialog.Content>
              </motion.div>
            </Dialog.Overlay>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
