import { useSyncExternalStore } from 'react'

/** Phones: under Tailwind's `md`. The canvas gives way to one screen at a time there. */
const media = window.matchMedia('(max-width: 767px)')

const subscribe = (onChange: () => void) => {
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => media.matches)
}
