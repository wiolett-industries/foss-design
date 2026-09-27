/**
 * Every frame of a canvas runs on one origin, so an app that caches in localStorage or IndexedDB
 * would hand one frame's data to the next: a screen's state would depend on which frames opened
 * before it. Each frame therefore gets storage of its own, fresh on every load, before the
 * screen's code runs (the runtime imports this first):
 * - localStorage and sessionStorage live in memory;
 * - IndexedDB databases are named `design:<frame>:<load>:<name>`, and those an earlier load of
 *   the same frame left behind (ten minutes ago or more) are deleted.
 */

const frame = new URLSearchParams(location.search).get('__design') || location.pathname

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  const api: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(String(key)) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(String(key)),
    setItem: (key, value) => void data.set(String(key), String(value)),
  }
  // `localStorage.theme = 'dark'` and `'theme' in localStorage` work on the real one too.
  return new Proxy(api, {
    get: (target, prop) =>
      typeof prop === 'string' && !(prop in target) ? (data.get(prop) ?? undefined) : Reflect.get(target, prop),
    set: (target, prop, value) => {
      if (typeof prop === 'string' && !(prop in target)) data.set(prop, String(value))
      return true
    },
    deleteProperty: (_, prop) => (typeof prop === 'string' ? data.delete(prop) || true : true),
    has: (target, prop) => (typeof prop === 'string' && data.has(prop)) || prop in target,
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_, prop) =>
      typeof prop === 'string' && data.has(prop)
        ? { value: data.get(prop), writable: true, enumerable: true, configurable: true }
        : undefined,
  })
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  try {
    Object.defineProperty(window, name, { configurable: true, value: memoryStorage() })
  } catch {}
}

const idb: IDBFactory | undefined = window.indexedDB
if (idb) {
  const own = `design:${frame}:`
  const prefix = `${own}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}:`
  const open = idb.open.bind(idb)
  const remove = idb.deleteDatabase.bind(idb)
  const list = idb.databases?.bind(idb)
  idb.open = (name: string, version?: number) => open(prefix + name, version)
  idb.deleteDatabase = (name: string) => remove(prefix + name)
  if (list) {
    idb.databases = async () =>
      (await list())
        .filter((db) => db.name?.startsWith(prefix))
        .map((db) => ({ ...db, name: db.name!.slice(prefix.length) }))
    // What earlier loads of this frame left: gone, so a changed fixture is not shadowed by a cache.
    void list()
      .then((dbs) => {
        for (const db of dbs) {
          if (!db.name?.startsWith(own) || db.name.startsWith(prefix)) continue
          // Ten minutes old at least: the same frame may be open elsewhere (play in another tab).
          const born = Number.parseInt(db.name.slice(own.length).split(':')[0]!.slice(0, -4), 36)
          if (!Number.isFinite(born) || Date.now() - born > 10 * 60 * 1000) remove(db.name)
        }
      })
      .catch(() => {})
  }
}

export {}
