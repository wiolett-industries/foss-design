import fs from 'node:fs'
import path from 'node:path'
import type { DesignPaths } from './paths'

/**
 * The project's icon: `.design/system/icon.svg`, `.png` or `.webp`, a plain file of the `system`
 * unit, so it syncs with the project and counts toward its cloud storage like any other file.
 */
export const ICON_EXTENSIONS = ['svg', 'png', 'webp'] as const
export type IconExtension = (typeof ICON_EXTENSIONS)[number]
/** The cloud's `max_icon_bytes` default; the CLI holds icons to it before they are pushed. */
export const MAX_ICON_BYTES = 256 * 1024

export const iconName = (ext: IconExtension) => `icon.${ext}`

/** The icon file in use (svg before png before webp), or null. */
export function iconFile(paths: DesignPaths): string | null {
  for (const ext of ICON_EXTENSIONS) {
    const file = path.join(paths.system, iconName(ext))
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  }
  return null
}

/** Which kind of image `data` is, by its first bytes; null for anything else. */
export function sniffIcon(data: Buffer): IconExtension | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png'
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP')
    return 'webp'
  const head = data.subarray(0, 4096).toString('utf8').replace(/^﻿/, '')
  // An XML prolog, comments and a doctype may come before the root element.
  const rest = head.replace(/^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, '')
  return /^<svg[\s>]/i.test(rest) ? 'svg' : null
}

/** Why `data` cannot be the icon, or null. */
export function iconProblem(data: Buffer, ext?: string): string | null {
  const kind = sniffIcon(data)
  if (!kind) return 'the icon must be an SVG, PNG or WebP image'
  if (ext && ext !== kind) return `the file is ${kind.toUpperCase()}, not ${ext.toUpperCase()}`
  if (data.length > MAX_ICON_BYTES)
    return `the icon is ${Math.ceil(data.length / 1024)} KB; the limit is ${MAX_ICON_BYTES / 1024} KB`
  return null
}

/** Replace the icon (any other `icon.*` goes), or remove it with null. */
export function writeIcon(paths: DesignPaths, data: Buffer | null): string | null {
  for (const ext of ICON_EXTENSIONS) fs.rmSync(path.join(paths.system, iconName(ext)), { force: true })
  if (!data) return null
  const ext = sniffIcon(data)!
  fs.mkdirSync(paths.system, { recursive: true })
  const file = path.join(paths.system, iconName(ext))
  fs.writeFileSync(file, data)
  return file
}

/** Whether the system folder holds nothing but the icon: then the project has no design system. */
export function onlyIcon(dir: string): boolean {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .every((name) => (ICON_EXTENSIONS as readonly string[]).some((ext) => name === iconName(ext as IconExtension)))
  } catch {
    return false
  }
}
