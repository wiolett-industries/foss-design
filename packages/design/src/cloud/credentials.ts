import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliError } from '../cli/log'

export const DEFAULT_CLOUD = 'https://app.fossdesign.dev'

export interface Credential {
  token: string
  email: string
}

/** A host as its origin: `https://app.fossdesign.dev`, no trailing slash. */
export function normalizeHost(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError(`"${value}" is not a URL (FOSS_DESIGN_CLOUD takes one like https://app.fossdesign.dev)`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new CliError(`"${value}" is not an http(s) URL (FOSS_DESIGN_CLOUD takes one like https://app.fossdesign.dev)`)
  return url.origin
}

/** The cloud to sign in to: `FOSS_DESIGN_CLOUD`, or foss-design Cloud. */
export function cloudHost(): string {
  return normalizeHost(process.env.FOSS_DESIGN_CLOUD || DEFAULT_CLOUD)
}

/** `$XDG_CONFIG_HOME/foss-design/credentials.json`, `~/.config/…` without it, `%APPDATA%\foss-design\…` on Windows. */
export function credentialsFile(): string {
  const base =
    process.platform === 'win32' && process.env.APPDATA
      ? process.env.APPDATA
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'foss-design', 'credentials.json')
}

function readAll(): Record<string, Credential> {
  const file = credentialsFile()
  if (!fs.existsSync(file)) return {}
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch (error) {
    throw new CliError(`${file} is not valid JSON (${(error as Error).message}); fix or delete it`)
  }
}

function writeAll(data: Record<string, Credential>) {
  const file = credentialsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(temp, 0o600)
  fs.renameSync(temp, file)
}

export function getCredential(host: string): Credential | null {
  const entry = readAll()[host]
  return entry && typeof entry.token === 'string' && entry.token ? entry : null
}

export function saveCredential(host: string, credential: Credential) {
  writeAll({ ...readAll(), [host]: credential })
}

/** Forget the token for `host`; false when there was none. */
export function removeCredential(host: string): boolean {
  const all = readAll()
  if (!(host in all)) return false
  delete all[host]
  writeAll(all)
  return true
}

export function requireCredential(host: string): Credential {
  const credential = getCredential(host)
  if (!credential) throw new CliError(`Not signed in to ${host}. Run \`design login\`.`)
  return credential
}
