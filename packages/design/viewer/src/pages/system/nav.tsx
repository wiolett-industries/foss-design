import type { SystemDoc } from '@shared/types'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { cn } from '../../lib/cn'
import { useIsPhone } from '../../lib/phone'
import { Icon } from '../../ui/icon'
import { type NavItem, NavLabel, SubNav } from '../../ui/page'
import { Sheet } from '../../ui/sheet'

/** Grouped links of the system section; a wrapping row above the content on narrow screens. */
export function SystemNav({ system }: { system: SystemDoc }) {
  const phone = useIsPhone()
  const kinds = new Set(system.tokens.map((token) => token.kind))
  const foundations: NavItem[] = [
    { to: '/system/colors', label: 'Colors', hint: count(system, 'color') },
    { to: '/system/typography', label: 'Typography' },
    { to: '/system/shape', label: 'Spacing & shape' },
  ]
  if (kinds.has('ease') || kinds.has('duration') || kinds.has('animation'))
    foundations.push({ to: '/system/motion', label: 'Motion' })
  if (kinds.has('other'))
    foundations.push({ to: '/system/tokens', label: 'Other tokens', hint: count(system, 'other') })
  if (system.assets.length) foundations.push({ to: '/system/assets', label: 'Assets', hint: system.assets.length })

  const groups = new Map<string, NavItem[]>()
  for (const component of system.components) {
    const list = groups.get(component.group) ?? []
    list.push({
      to: `/system/components/${encodeURIComponent(component.id)}`,
      label: component.title,
      hint: component.status,
    })
    groups.set(component.group, list)
  }

  // The overview guideline is the body of the Overview page.
  const guidelines = system.guidelines.filter((guide) => guide.slug !== 'overview')

  if (phone) {
    const sections: { label: string; items: NavItem[] }[] = [
      { label: '', items: [{ to: '/system', label: 'Overview' }] },
      { label: 'Foundations', items: foundations },
      {
        label: 'Guidelines',
        items: guidelines.map((guide) => ({
          to: `/system/guidelines/${encodeURIComponent(guide.slug)}`,
          label: guide.title,
        })),
      },
      ...[...groups].map(([label, items]) => ({ label, items })),
    ]
    return <PhoneSystemNav sections={sections.filter((section) => section.items.length)} />
  }

  return (
    <div className="flex flex-col max-lg:gap-1 max-lg:[&_nav]:flex-row max-lg:[&_nav]:flex-wrap">
      <SubNav label="Overview" items={[{ to: '/system', label: 'Overview' }]} />
      <NavLabel>Foundations</NavLabel>
      <SubNav label="Foundations" items={foundations} />
      {guidelines.length ? (
        <>
          <NavLabel>Guidelines</NavLabel>
          <SubNav
            label="Guidelines"
            items={guidelines.map((guide) => ({
              to: `/system/guidelines/${encodeURIComponent(guide.slug)}`,
              label: guide.title,
            }))}
          />
        </>
      ) : null}
      {[...groups].map(([group, items]) => (
        <div key={group} className="flex flex-col">
          <NavLabel>{group}</NavLabel>
          <SubNav label={group} items={items} />
        </div>
      ))}
    </div>
  )
}

function count(system: SystemDoc, kind: string): number | undefined {
  const n = system.tokens.filter((token) => token.kind === kind).length
  return n || undefined
}

/** On a phone: the current section on a full-width button that lists them all in a sheet. */
function PhoneSystemNav({ sections }: { sections: { label: string; items: NavItem[] }[] }) {
  const [location] = useLocation()
  const [open, setOpen] = useState(false)
  const current = sections.flatMap((section) => section.items).find((item) => item.to === location)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-[8px] border border-rule bg-surface px-3.5 text-left text-[14px] text-ink"
      >
        <span className="text-[12.5px] text-muted">Section</span>
        <span className="min-w-0 grow truncate font-medium">{current?.label ?? 'Overview'}</span>
        <Icon name="chevron-down" size={16} className="shrink-0 text-muted" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Design system">
        <nav aria-label="Design system" className="flex flex-col pb-2">
          {sections.map((section) => (
            <div key={section.label || 'overview'} className="flex flex-col">
              {section.label ? <div className="px-4 pt-3 pb-1 text-[12px] text-muted">{section.label}</div> : null}
              {section.items.map((item) => {
                const on = item.to === location
                return (
                  <Link
                    key={item.to}
                    href={item.to}
                    onClick={() => setOpen(false)}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[46px] items-center gap-2 px-4 text-[14px] no-underline active:bg-soft2',
                      on ? 'font-medium text-ink' : 'text-ink2',
                    )}
                  >
                    <span className="min-w-0 grow truncate">{item.label}</span>
                    {item.hint ? <span className="text-[12.5px] text-muted">{item.hint}</span> : null}
                    {on ? <Icon name="check" size={16} className="shrink-0 text-action" /> : null}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </Sheet>
    </>
  )
}
