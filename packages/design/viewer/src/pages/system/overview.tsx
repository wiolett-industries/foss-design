import type { SystemDoc, TokenKind } from '@shared/types'
import { Link, useLocation } from 'wouter'
import { IssuesPanel } from '../../components/issues'
import { Markdown } from '../../components/markdown'
import { plural } from '../../lib/format'
import { Count } from '../../ui/badge'
import { Icon, type IconName } from '../../ui/icon'
import { PageHead } from '../../ui/page'
import { Panel, PanelHead, Row } from '../../ui/panel'
import { Mono } from '../../ui/text'

function kindCount(system: SystemDoc, ...kinds: TokenKind[]) {
  return system.tokens.filter((token) => kinds.includes(token.kind)).length
}

interface Section {
  to: string
  icon: IconName
  title: string
  text: string
}

function sections(system: SystemDoc): Section[] {
  const list: Section[] = [
    { to: '/system/colors', icon: 'palette', title: 'Colors', text: plural(kindCount(system, 'color'), 'token') },
    {
      to: '/system/typography',
      icon: 'type',
      title: 'Typography',
      text: `${plural(kindCount(system, 'font'), 'family', 'families')} · ${plural(kindCount(system, 'text'), 'size')}`,
    },
    {
      to: '/system/shape',
      icon: 'shape',
      title: 'Spacing & shape',
      text: plural(kindCount(system, 'spacing', 'radius', 'shadow', 'blur', 'breakpoint'), 'token'),
    },
  ]
  const motion = kindCount(system, 'ease', 'duration', 'animation')
  if (motion) list.push({ to: '/system/motion', icon: 'motion', title: 'Motion', text: plural(motion, 'token') })
  if (system.assets.length)
    list.push({ to: '/system/assets', icon: 'image', title: 'Assets', text: plural(system.assets.length, 'file') })
  const first = system.components[0]
  if (first)
    list.push({
      to: `/system/components/${encodeURIComponent(first.id)}`,
      icon: 'component',
      title: 'Components',
      text: plural(system.components.length, 'component'),
    })
  return list
}

function SectionCards({ system }: { system: SystemDoc }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {sections(system).map((section) => (
        <Link
          key={section.to}
          href={section.to}
          className="flex items-center gap-3 rounded-[10px] border border-rule bg-surface px-4 py-3.5 text-inherit no-underline transition-colors hover:border-rule-strong hover:bg-soft"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-soft2 text-ink2">
            <Icon name={section.icon} size={17} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[14px] font-medium text-ink">{section.title}</span>
            <span className="truncate text-[12.5px] text-muted">{section.text}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

function AtAGlance({ system }: { system: SystemDoc }) {
  const [, navigate] = useLocation()
  const rows: { label: string; value: number; to?: string }[] = [
    { label: 'Color tokens', value: kindCount(system, 'color'), to: '/system/colors' },
    {
      label: 'Type tokens',
      value: kindCount(system, 'font', 'text', 'weight', 'leading', 'tracking'),
      to: '/system/typography',
    },
    {
      label: 'Spacing & shape tokens',
      value: kindCount(system, 'spacing', 'radius', 'shadow', 'blur', 'breakpoint'),
      to: '/system/shape',
    },
    { label: 'Motion tokens', value: kindCount(system, 'ease', 'duration', 'animation'), to: '/system/motion' },
    { label: 'Other tokens', value: kindCount(system, 'other'), to: '/system/tokens' },
    { label: 'Components', value: system.components.length },
    { label: 'Guidelines', value: system.guidelines.length },
  ]
  return (
    <Panel>
      <PanelHead title="At a glance" />
      {rows
        .filter((row) => row.value || !row.to || row.to === '/system/colors')
        .map((row) => (
          <Row
            key={row.label}
            cols="minmax(0,1fr) auto"
            align="lr"
            minH={40}
            pad="8px 16px"
            onClick={row.to && row.value ? () => navigate(row.to!) : undefined}
          >
            <span className="text-[13.5px] text-ink2">{row.label}</span>
            <Count value={row.value} />
          </Row>
        ))}
      {system.fonts.length ? (
        <Row cols="minmax(0,1fr) auto" align="lr" minH={40} pad="8px 16px">
          <span className="text-[13.5px] text-ink2">Web fonts</span>
          <span className="flex min-w-0 flex-col items-end gap-0.5">
            {system.fonts.map((href) => (
              <Mono key={href} size={12} className="max-w-[260px] truncate text-muted" title={href}>
                {fontLabel(href)}
              </Mono>
            ))}
          </span>
        </Row>
      ) : null}
    </Panel>
  )
}

/** `Manrope, JetBrains Mono` from a Google Fonts URL, the host otherwise. */
function fontLabel(href: string): string {
  try {
    const url = new URL(href)
    const families = url.searchParams.getAll('family').map((family) => family.split(':')[0]!.replace(/\+/g, ' '))
    return families.length ? families.join(', ') : url.host
  } catch {
    return href
  }
}

export function OverviewPage({ system }: { system: SystemDoc }) {
  const overview = system.guidelines.find((guide) => guide.slug === 'overview')
  return (
    <>
      <PageHead title={system.name} sub={system.description} />
      <IssuesPanel issues={system.issues} title="Problems in the design system" />
      <SectionCards system={system} />
      <div
        className="grid items-start gap-5 max-xl:grid-cols-1!"
        style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}
      >
        {overview ? (
          <Panel>
            <div className="px-6 py-5">
              <Markdown text={overview.markdown} />
            </div>
          </Panel>
        ) : (
          <Panel>
            <PanelHead title="Overview" />
            <div className="border-t border-rule px-4 py-5 text-[13px] text-muted">
              Write the principles every screen follows in <Mono>.design/system/guidelines/01-overview.md</Mono>; it
              shows here.
            </div>
          </Panel>
        )}
        <AtAGlance system={system} />
      </div>
    </>
  )
}
