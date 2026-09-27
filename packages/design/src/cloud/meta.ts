import fs from 'node:fs'
import path from 'node:path'
import { ICON_TYPES, type IconExtension, iconFile, iconHash, sniffIcon, writeIcon } from '../core/icon'
import type { DesignPaths } from '../core/paths'
import { type CloudClient, CloudError } from './client'
import type { CloudLink } from './state'

/**
 * The project's own metadata between this `.design` and its cloud project: the name (the cloud's,
 * kept in cloud.json) and the icon (`.design/icon.*` here, the project icon there). Neither is a
 * unit, so they sync without revisions. The icon works like a unit against its base in cloud.json:
 * changed here only, it goes up; changed in the cloud, it comes down; changed on both sides, the
 * cloud's wins. Updates `link` in place; returns lines worth telling the user.
 */
export async function syncProjectMeta(paths: DesignPaths, client: CloudClient, link: CloudLink): Promise<string[]> {
  const remote = await client.project(link.project)
  if (!remote) return []
  const lines: string[] = []
  link.name = remote.name

  const file = iconFile(paths)
  const local = file ? iconHash(file) : null
  const cloud = remote.icon
  if (local === cloud) {
    link.icon = cloud
    return lines
  }
  const base = link.icon
  // Before the first sync of the icon there is no base: an icon on one side only is that side's change.
  const localChanged = base === undefined ? cloud === null : local !== base
  const cloudChanged = base === undefined ? local === null : cloud !== base
  if (localChanged && !cloudChanged) {
    try {
      if (file) {
        const ext = path.extname(file).slice(1) as IconExtension
        await client.setProjectIcon(link.project, { data: fs.readFileSync(file), type: ICON_TYPES[ext] })
        lines.push('The project icon went up to the cloud.')
      } else {
        await client.setProjectIcon(link.project, null)
        lines.push('The project icon was removed in the cloud too.')
      }
      link.icon = local
    } catch (error) {
      if (!(error instanceof CloudError) || error.status === 0) throw error
      lines.push(`The project icon stays here only: ${error.message}`)
    }
    return lines
  }
  const icon = cloud ? await client.projectIcon(link.project) : null
  if (icon && !sniffIcon(icon.data))
    return [...lines, 'The cloud sent a project icon that is no image; it was left out.']
  writeIcon(paths, icon?.data ?? null)
  link.icon = cloud
  lines.push(
    localChanged
      ? "The project icon changed here and in the cloud; the cloud's is kept."
      : cloud
        ? 'The project icon came down from the cloud.'
        : 'The project icon was removed in the cloud, so here too.',
  )
  return lines
}
