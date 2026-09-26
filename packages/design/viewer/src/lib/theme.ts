import { useSyncExternalStore } from 'react'
import { Store, useStore } from './store'

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'foss-design.theme'

function readPref(): ThemePref {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {}
  return 'system'
}

const pref = new Store<ThemePref>(readPref())
const media = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(value: ThemePref): Theme {
  return value === 'system' ? (media.matches ? 'dark' : 'light') : value
}

function apply() {
  document.documentElement.dataset.theme = resolve(pref.get())
}

media.addEventListener('change', apply)
pref.subscribe(apply)
// index.html applies it before first paint; an app that embeds the viewer gets it here.
apply()

export function setThemePref(value: ThemePref) {
  try {
    localStorage.setItem(KEY, value)
  } catch {}
  pref.set(value)
}

export function useThemePref(): ThemePref {
  return useStore(pref)
}

/** The theme the app shows: the saved choice, or the system's. */
export function useTheme(): Theme {
  const value = useStore(pref)
  const systemDark = useSyncExternalStore(
    (listener) => {
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    () => media.matches,
  )
  return value === 'system' ? (systemDark ? 'dark' : 'light') : value
}
