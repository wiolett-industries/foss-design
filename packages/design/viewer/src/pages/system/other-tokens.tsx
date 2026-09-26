import type { SystemDoc } from '@shared/types'
import { copyText } from '../../lib/copy'
import { PageHead } from '../../ui/page'
import { Panel, PanelHead, Row, THead } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { byKind, EmptyPanel, groupTokens, TOKENS_FILE, Value } from './shared'

export function OtherTokensPage({ system }: { system: SystemDoc }) {
  const tokens = byKind(system.tokens, 'other')
  const cols = 'minmax(170px,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr)'
  return (
    <>
      <PageHead title="Other tokens" sub="Variables that are not colors, type, spacing, shape or motion." />
      {tokens.length ? (
        groupTokens(tokens).map(({ group, tokens: list }) => (
          <Panel key={group}>
            <PanelHead title={group} count={list.length} />
            <THead cols={cols} labels={['Token', 'Light', 'Dark', 'Description']} />
            {list.map((token) => (
              <Row
                key={token.name}
                cols={cols}
                minH={40}
                title="Copy the variable"
                onClick={() => copyText(`var(${token.name})`)}
              >
                <Mono size={12.5} className="truncate text-ink">
                  {token.name}
                </Mono>
                <Value>{token.light?.value}</Value>
                <Value>{token.dark?.value ?? '—'}</Value>
                <span className="text-[13px] text-ink2">{token.description}</span>
              </Row>
            ))}
          </Panel>
        ))
      ) : (
        <EmptyPanel title="No other tokens">
          Variables in <Mono>:root</Mono> of <Mono>{TOKENS_FILE}</Mono> that are not colors or lengths show here.
        </EmptyPanel>
      )}
    </>
  )
}
