import fs from 'node:fs'
import type { Browser, Page } from 'playwright-core'

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
}

/** Open a frame URL and wait until the runtime says it is ready (fonts loaded, first paint done). */
export async function openFrame(
  page: Page,
  url: string,
  options: { timeoutMs?: number; settleMs?: number; waitForReady?: boolean } = {},
): Promise<FrameReport> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // Format strings ("%o\n\n%s") arrive unexpanded with the arguments appended; keep the arguments.
    if (message.type() === 'error') errors.push(message.text().replace(/^(?:\s*%[osdifcO])+\s*/, ''))
  })
  await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs ?? 30000 })
  // Pages without the runtime (url items) never signal; for them loading is ready enough.
  let ready = options.waitForReady === false
  if (!ready) {
    try {
      await page.waitForFunction(() => (window as { __DESIGN_READY__?: boolean }).__DESIGN_READY__ === true, null, {
        timeout: options.timeoutMs ?? 20000,
      })
      ready = true
    } catch {}
  }
  // Let entrance animations finish before anyone looks.
  await page.waitForTimeout(options.settleMs ?? 700)
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
  return { errors: [...new Set(unique)], ready }
}
