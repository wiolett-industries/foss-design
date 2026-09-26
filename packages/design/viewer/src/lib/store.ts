import { useSyncExternalStore } from 'react'

/** A tiny observable value for state shared outside React's tree. */
export class Store<T> {
  private listeners = new Set<() => void>()

  constructor(private value: T) {}

  get = () => this.value

  set = (next: T | ((prev: T) => T)) => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(this.value) : next
    if (Object.is(value, this.value)) return
    this.value = value
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export function useStore<T, S = T>(store: Store<T>, select: (value: T) => S = (value) => value as unknown as S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  )
}
