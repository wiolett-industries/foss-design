import type { AssetDoc, SystemDoc } from '@shared/types'
import { copyText } from '../../lib/copy'
import { bytes } from '../../lib/format'
import { Icon } from '../../ui/icon'
import { PageHead } from '../../ui/page'
import { Panel } from '../../ui/panel'
import { Mono } from '../../ui/text'
import { EmptyPanel } from './shared'

function Preview({ asset, index }: { asset: AssetDoc; index: number }) {
  if (asset.kind === 'image') {
    return (
      <span className="checker flex h-[132px] items-center justify-center overflow-hidden border-b border-rule">
        <img src={asset.url} alt="" className="max-h-[96px] max-w-[80%] object-contain" />
      </span>
    )
  }
  if (asset.kind === 'font') {
    const family = `design-asset-font-${index}`
    return (
      <span className="flex h-[132px] items-center justify-center border-b border-rule bg-soft">
        <style>{`@font-face{font-family:"${family}";src:url("${asset.url.replace(/"/g, '%22')}")}`}</style>
        <span className="text-[52px] leading-none text-ink" style={{ fontFamily: `"${family}", var(--font-sans)` }}>
          Aa
        </span>
      </span>
    )
  }
  return (
    <span className="flex h-[132px] items-center justify-center border-b border-rule bg-soft text-muted">
      <Icon name="file" size={28} />
    </span>
  )
}

export function AssetsPage({ system }: { system: SystemDoc }) {
  if (!system.assets.length) {
    return (
      <>
        <PageHead title="Assets" />
        <EmptyPanel title="No assets">
          Put logos, icons, images and font files in <Mono>.design/system/assets</Mono>; screens import them as{' '}
          <Mono>@system/assets/…</Mono>.
        </EmptyPanel>
      </>
    )
  }
  return (
    <>
      <PageHead title="Assets" sub="Click an asset to copy its import path." />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
        {system.assets.map((asset, index) => (
          <button
            key={asset.path}
            type="button"
            title="Copy the import path"
            onClick={() => copyText(`@system/${asset.path}`)}
            className="block cursor-pointer border-0 bg-transparent p-0 text-left"
          >
            <Panel className="transition-colors hover:border-rule-strong">
              <Preview asset={asset} index={index} />
              <span className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5">
                <span className="truncate text-[13.5px] font-medium text-ink">{asset.name}</span>
                <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
                  <span className="shrink-0">{bytes(asset.size)}</span>
                  <Mono size={12} className="truncate">
                    {asset.path}
                  </Mono>
                </span>
              </span>
            </Panel>
          </button>
        ))}
      </div>
    </>
  )
}
