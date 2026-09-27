import fs from 'node:fs'
import type { Browser, Frame, Page } from 'playwright-core'

const CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
}

/** An installed Chromium-family browser: `DESIGN_CHROME` wins, then the usual install paths. */
export function findChrome(): string | null {
  const configured = process.env.DESIGN_CHROME
  if (configured && fs.existsSync(configured)) return configured
  for (const candidate of CANDIDATES[process.platform] ?? []) if (fs.existsSync(candidate)) return candidate
  return null
}

export async function launchChrome(): Promise<Browser> {
  const executablePath = findChrome()
  if (!executablePath) {
    throw new Error(
      'No Chrome, Chromium or Edge found. Install one, or point DESIGN_CHROME at a Chromium-based browser binary.',
    )
  }
  const { chromium } = await import('playwright-core')
  return chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
}

export interface FrameReport {
  errors: string[]
  ready: boolean
  /** Holds from `holdReady()` still open when the frame gave up waiting. */
  held?: number
}

/** Vite answers this while it bundles dependencies it just found; the page loads fine once it is done. */
const OUTDATED_DEP = /Outdated Optimize Dep/

/** Open a frame URL and wait until the runtime says it is ready (fonts loaded, first paint done). */
export async function openFrame(
  page: Page,
  url: string,
  options: { timeoutMs?: number; settleMs?: number; waitForReady?: boolean } = {},
): Promise<FrameReport> {
  let errors: string[] = []
  // Resolves when Vite turns a request away while it bundles again; the frame is then loaded once more.
  let outdated: () => void = () => {}
  const record = (text: string) => {
    errors.push(text)
    if (OUTDATED_DEP.test(text)) outdated()
  }
  page.on('pageerror', (error) => record(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Format strings ("%o\n\n%s") arrive unexpanded with the arguments appended; keep the arguments.
    let text = message.text().replace(/^(?:\s*%[osdifcO])+\s*/, '')
    // Chrome leaves the URL out of a failed load; it is the one thing needed to fix it.
    const where = message.location().url
    if (/^Failed to load resource/.test(text) && where && !text.includes(where)) text += ` (${where})`
    record(text)
  })
  let ready = false
  // A frame that reloads itself never holds a state. Once is how Vite takes in dependencies it just
  // bundled, so that load is given a second try; a frame that reloads again is reported.
  let reloads = 0
  const onNavigate = (frame: Frame) => {
    if (frame === page.mainFrame()) reloads++
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    errors = []
    reloads = 0
    // Pages without the runtime (url items) never signal; for them loading is ready enough.
    ready = options.waitForReady === false
    const turnedAway = new Promise<'outdated'>((resolve) => {
      outdated = () => resolve('outdated')
    })
    await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs ?? 30000 })
    page.on('framenavigated', onNavigate)
    if (!ready) {
      const signal = page
        .waitForFunction(() => (window as { __DESIGN_READY__?: boolean }).__DESIGN_READY__ === true, null, {
          timeout: options.timeoutMs ?? 20000,
        })
        .then(() => 'ready' as const)
      signal.catch(() => {})
      ready = (await Promise.race([signal, turnedAway]).catch(() => null)) === 'ready'
    }
    // Let entrance animations finish before anyone looks.
    if (ready || options.waitForReady === false) await page.waitForTimeout(options.settleMs ?? 700)
    page.off('framenavigated', onNavigate)
    if (!reloads && !errors.some((error) => OUTDATED_DEP.test(error))) break
  }
  if (reloads) errors.push(`the page reloaded itself ${reloads === 1 ? 'once' : `${reloads} times`} while it loaded`)
  const held = ready
    ? 0
    : await page.evaluate(() => (window as { __DESIGN_HOLDS__?: number }).__DESIGN_HOLDS__ ?? 0).catch(() => 0)
  const runtimeErrors = await page
    .evaluate(() => (window as { __DESIGN_ERRORS__?: string[] }).__DESIGN_ERRORS__ ?? [])
    .catch(() => [] as string[])
  for (const error of runtimeErrors) if (!errors.includes(error)) errors.push(error)
  const overlay = await page
    .evaluate(() => {
      const el = document.querySelector('vite-error-overlay') as (HTMLElement & { shadowRoot: ShadowRoot }) | null
      return el?.shadowRoot?.querySelector('.message')?.textContent ?? null
    })
    .catch(() => null)
  if (overlay) errors.unshift(overlay.trim())
  // The same failure often arrives twice: as the runtime's message and inside a longer console dump.
  const unique = errors.filter(
    (error, index) =>
      error && !errors.some((other, j) => j !== index && other && other.length < error.length && error.includes(other)),
  )
  return { errors: [...new Set(unique)], ready, ...(held ? { held } : {}) }
}
