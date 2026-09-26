import type { SystemDoc } from '@shared/types'
import { type NavItem, NavLabel, SubNav } from '../../ui/page'

/** Grouped links of the system section; a wrapping row above the content on narrow screens. */
export function SystemNav({ system }: { system: SystemDoc }) {
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
