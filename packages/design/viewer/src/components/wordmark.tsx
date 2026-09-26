import { Link } from 'wouter'

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <rect x="7" y="7" width="8" height="11" rx="1.5" className="fill-primary-ink" />
      <rect x="17" y="7" width="8" height="6" rx="1.5" fill="#f0a040" />
      <rect x="17" y="15" width="8" height="10" rx="1.5" className="fill-primary-ink" />
      <rect x="7" y="20" width="8" height="5" rx="1.5" className="fill-primary-ink" />
    </svg>
  )
}

export function Wordmark({ name, version }: { name?: string; version?: string }) {
  return (
    <Link
      href="/"
      title={version ? `foss-design ${version}` : undefined}
      className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-ink no-underline"
    >
      <Mark />
      <span className="truncate">{name ?? 'Design'}</span>
    </Link>
  )
}
