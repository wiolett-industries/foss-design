import type { SystemDoc, Token } from '@shared/types'
import { AutoFrame } from '../../components/auto-frame'
import { copyText } from '../../lib/copy'
import { PageHead } from '../../ui/page'
import { Panel, PanelHead, Row, THead } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { byKind, EmptyPanel, Hints, ThemeSwitch, TOKENS_FILE, useLocalTheme, utilityHints, Value } from './shared'

const KIND_LABEL: Record<string, string> = {
  font: 'Family',
  text: 'Size',
  weight: 'Weight',
  leading: 'Line height',
  tracking: 'Letter spacing',
}

function value(token: Token): string {
  if (token.kind === 'text') return [token.light?.value, token.lineHeight].filter(Boolean).join(' / ')
  return token.light?.value ?? ''
}

export function TypographyPage({ system }: { system: SystemDoc }) {
  const [theme, setTheme] = useLocalTheme()
  const tokens = byKind(system.tokens, 'font', 'text', 'weight', 'leading', 'tracking')
  return (
    <>
      <PageHead title="Typography" sub="Set in the design system's own stylesheet, with its fonts." />
      {system.typographyUrl ? (
        <Panel>
          <PanelHead title="Specimen" right={<ThemeSwitch value={theme} onChange={setTheme} />} />
          <div className="border-t border-rule">
            <AutoFrame src={system.typographyUrl} theme={theme} title="Typography specimen" minHeight={200} />
          </div>
        </Panel>
      ) : null}
      {tokens.length ? (
        <Panel>
          <PanelHead title="Tokens" count={tokens.length} />
          <THead
            cols="minmax(160px,1fr) 110px minmax(120px,0.8fr) minmax(0,1.4fr)"
            labels={['Token', 'Kind', 'Class', 'Value']}
          />
          {tokens.map((token) => (
            <Row
              key={token.name}
              cols="minmax(160px,1fr) 110px minmax(120px,0.8fr) minmax(0,1.4fr)"
              minH={42}
              title="Copy the variable"
              onClick={() => copyText(`var(${token.name})`)}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Mono size={12.5} className="truncate text-ink">
                  {token.name}
                </Mono>
                {token.description ? (
                  <span className="truncate text-[12.5px] text-muted">{token.description}</span>
                ) : null}
              </span>
              <span className="text-[13px] text-ink2">{KIND_LABEL[token.kind]}</span>
              <Hints items={utilityHints(token)} />
              <Value>{value(token)}</Value>
            </Row>
          ))}
        </Panel>
      ) : (
        <EmptyPanel title="No type tokens">
          Add font families (<Mono>--font-*</Mono>), sizes (<Mono>--text-*</Mono> with{' '}
          <Mono>--text-*--line-height</Mono>) and weights (<Mono>--font-weight-*</Mono>) to the <Mono>@theme</Mono>{' '}
          block in <Mono>{TOKENS_FILE}</Mono>. Web fonts go in <Mono>system.json</Mono> <Mono>fonts</Mono>.
        </EmptyPanel>
      )}
    </>
  )
}
