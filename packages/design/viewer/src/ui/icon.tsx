import { ICON_PATHS, type IconName } from './icon-paths'

export type { IconName }

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${name === 'loader' ? 'animate-spin' : ''} ${className ?? ''}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static icon paths from the kit
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  )
}
