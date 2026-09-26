import type { ComponentDoc, SystemDoc, Theme } from '@shared/types'
import { useState } from 'react'
import { AutoFrame } from '../../components/auto-frame'
import { CodeView } from '../../components/code-view'
import { useSource } from '../../lib/api'
import { copyText } from '../../lib/copy'
import { absoluteUrl, frameSrc } from '../../lib/frames'
import { useViewer } from '../../lib/viewer'
import { Badge, type Tone } from '../../ui/badge'
import { ButtonAnchor, IconButton } from '../../ui/button'
import { Segmented } from '../../ui/choice'
import { Icon } from '../../ui/icon'
import { PageHead } from '../../ui/page'
import { Panel, PanelTabs } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { NotFound } from '../not-found'
import { ThemeSwitch, useLocalTheme } from './shared'

type Width = 'fill' | '768' | '390'

const STATUS_TONE: Record<string, Tone> = {
  beta: 'action',
  experimental: 'action',
  draft: 'action',
  deprecated: 'danger',
  stable: 'ok',
}

const COMPONENTS_DIR = '.design/system/components/'

/** `@system/components/input` for a file in the system's components folder. */
function importPath(path: string): string | null {
  if (!path.startsWith(COMPONENTS_DIR)) return null
  return `@system/components/${path
    .slice(COMPONENTS_DIR.length)
    .replace(/\.(tsx|jsx|ts|js)$/, '')
    .replace(/\/index$/, '')}`
}

/** Names a module exports, read from its source. */
function exportedNames(code: string): string[] {
  const names = new Set<string>()
  for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/g))
    names.add(match[1]!)
  for (const match of code.matchAll(/export\s*\{([^}]+)\}/g))
    for (const part of match[1]!.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name && name !== 'default') names.add(name)
    }
  return [...names].filter((name) => /^[A-Z]/.test(name))
}

function ImportHint({ path }: { path: string }) {
  const module = importPath(path)
  const source = useSource(module ? path : null).data
  if (!module) return null
  const names = source ? exportedNames(source) : []
  const line = `import { ${names.length ? names.join(', ') : '…'} } from '${module}'`
  return (
    <div className="flex items-center gap-2 border-b border-rule py-1.5 pr-1.5 pl-4">
      <Mono size={12.5} className="min-w-0 truncate text-ink2" title={line}>
        {line}
      </Mono>
      <IconButton icon="copy" label="Copy the import" size={14} className="ml-auto" onClick={() => copyText(line)} />
    </div>
  )
}

function Preview({ component, theme, width }: { component: ComponentDoc; theme: Theme; width: Width }) {
  if (width === 'fill') {
    return <AutoFrame src={component.url} theme={theme} title={component.title} minHeight={160} />
  }
  return (
    <div className="flex justify-center overflow-x-auto bg-soft p-6">
      <div className="shrink-0 overflow-hidden rounded-[8px] border border-rule bg-surface shadow-frame">
        <AutoFrame src={component.url} theme={theme} title={component.title} minHeight={160} width={Number(width)} />
      </div>
    </div>
  )
}

function Code({ component }: { component: ComponentDoc }) {
  const files = [...component.sources, component.specimen]
  const [picked, setPicked] = useState(files[0]!)
  const path = files.includes(picked) ? picked : files[0]!
  const { data, error, isLoading } = useSource(path)
  return (
    <div className="flex min-w-0 flex-col">
      {files.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
          <Segmented
            label="File"
            size="sm"
            value={path}
            onChange={setPicked}
            items={files.map((file) => ({
              value: file,
              label: file === component.specimen ? `${basename(file)} · specimen` : basename(file),
              title: file,
            }))}
          />
        </div>
      ) : null}
      {importPath(path) ? <ImportHint path={path} /> : null}
      {error ? (
        <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-danger-text">
          <Icon name="alert" size={15} />
          {(error as Error).message}
        </div>
      ) : isLoading || data === undefined ? (
        <div className="flex items-center justify-center py-10 text-muted">
          <Icon name="loader" size={18} />
        </div>
      ) : (
        <CodeView code={data} path={path} />
      )}
    </div>
  )
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

export function ComponentPage({ system, id }: { system: SystemDoc; id: string }) {
  const component = system.components.find((item) => item.id === id)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [theme, setTheme] = useLocalTheme()
  const [width, setWidth] = useState<Width>('fill')
  // Sandboxed specimens are served to frames only; a tab of their own would not load.
  const openable = !useViewer().frameSandbox
  if (!component)
    return <NotFound title="No such component" text={`There is no specimen "${id}" in .design/system/specimens.`} />
  const status = component.status?.toLowerCase()
  return (
    <>
      <PageHead
        title={component.title}
        badge={
          <span className="flex items-center gap-1.5">
            <Badge>{component.group}</Badge>
            {status ? <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{component.status}</Badge> : null}
          </span>
        }
        sub={component.description}
      />
      <Panel>
        <PanelTabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'preview', label: 'Preview' },
            { value: 'code', label: 'Code', count: component.sources.length + 1 },
          ]}
          right={
            tab === 'preview' ? (
              <>
                <Segmented
                  label="Width"
                  size="sm"
                  value={width}
                  onChange={setWidth}
                  items={[
                    { value: 'fill', label: 'Fill' },
                    { value: '768', label: '768' },
                    { value: '390', label: '390' },
                  ]}
                />
                <ThemeSwitch value={theme} onChange={setTheme} />
                {openable ? (
                  <ButtonAnchor
                    icon="external"
                    href={absoluteUrl(frameSrc(component.url, theme))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </ButtonAnchor>
                ) : null}
              </>
            ) : null
          }
        />
        <div className="border-t border-rule">
          {tab === 'preview' ? (
            <Preview component={component} theme={theme} width={width} />
          ) : (
            <Code component={component} />
          )}
        </div>
      </Panel>
    </>
  )
}
