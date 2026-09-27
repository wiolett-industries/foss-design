import os from 'node:os'
import { CliError } from '../cli/log'
import { packageVersion } from '../core/paths'
import { type FileEntry, hashBuffer, isUnitKey, type Manifest } from './units'

/** A refusal from the cloud (`{error, message, limit?}`), or no answer at all (`status` 0). */
export class CloudError extends CliError {
  constructor(
    message: string,
    readonly status: number,
    readonly error: string,
    readonly limit?: string,
    exitCode = 1,
  ) {
    super(message, exitCode)
  }
}

export interface Me {
  email: string
  name?: string
}

export interface RemoteProject {
  id: string
  name: string
  role: string
  archived: boolean
  banned: boolean
}

export interface RemoteUnit {
  key: string
  title: string
  headRev: number
  archived: boolean
  banned: boolean
  /** Source files of the head revision, relative to `.design`. */
  manifest: Manifest
  systemRev: number | null
}

export interface PushUnit {
  key: string
  baseRev: number
  title: string
  source: Manifest
  build: Manifest
  /** For canvases, the system head the build was made against (before this push); null for `system`. */
  systemRev: number | null
}

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  interval?: number
  expires_in?: number
}

const DEFAULT_MESSAGE: Record<number, string> = {
  400: 'The cloud refused the request',
  403: 'Not allowed',
  404: 'Not found, or you are not a member of this project',
  409: 'Changed in the cloud since your last pull',
  410: 'No longer available',
  413: 'Too large for your limits',
  423: 'Archived; unarchive it in the web app first',
  429: 'Limit reached; try again later',
  451: 'Blocked by moderation',
  507: 'The cloud is out of storage',
}

const JSON_TIMEOUT = 60_000
const BLOB_TIMEOUT = 600_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/**
 * Text from the cloud that ends up in the terminal (names, titles, emails, messages). Collaborators
 * control some of it, so control characters are dropped: no escape sequences reach the terminal.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
export const plainText = (value: string) => value.replace(CONTROL, '')
const text = (value: unknown) => {
  const found = str(value)
  return found === undefined ? undefined : plainText(found)
}
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const flag = (...values: unknown[]) => values.some((value) => value === true || (typeof value === 'string' && !!value))

export const clientName = () => `foss-design ${packageVersion()}`

function errorFor(host: string, status: number, body: unknown, retryAfter: string | null): CloudError {
  const data = record(body)
  const code = str(data.error) ?? `http_${status}`
  const limit = str(data.limit) ?? (num(data.limit) !== undefined ? String(data.limit) : undefined)
  if (status === 401)
    return new CloudError(`Not signed in to ${host}, or the token was revoked. Run \`design login\`.`, status, code)
  let message = text(data.message) ?? DEFAULT_MESSAGE[status] ?? `${host} answered ${status}`
  // Without the cloud's own JSON the answer came from a proxy in front of it, not from a plan limit.
  if (status === 413 && !str(data.error)) message = `A proxy in front of ${host} refused it as too large (HTTP 413)`
  if (code === 'account_banned') message = `Your account is banned: ${message}`
  if (limit) message += ` (limit: ${limit})`
  if (status === 429 && retryAfter) message += `; retry in ${retryAfter}s`
  if (status >= 500 && status !== 507) message = `${host} failed (${status}): ${message}`
  return new CloudError(message, status, code, limit, status === 409 ? 2 : 1)
}

function parseManifest(value: unknown): Manifest {
  const manifest: Manifest = {}
  for (const [file, entry] of Object.entries(record(value))) {
    const item: FileEntry | null =
      typeof entry === 'string'
        ? { hash: entry, size: -1 }
        : str(record(entry).hash)
          ? { hash: str(record(entry).hash)!, size: num(record(entry).size) ?? -1 }
          : null
    if (item) manifest[file] = item
  }
  return manifest
}

function parseProject(value: unknown, fallbackRole: string): RemoteProject | null {
  const data = record(value)
  const id = text(data.id) ?? (num(data.id) !== undefined ? String(data.id) : undefined)
  if (!id) return null
  return {
    id,
    name: text(data.name) ?? id,
    role: text(data.role) ?? fallbackRole,
    archived: flag(data.archived, data.archivedAt, data.archived_at),
    banned: flag(data.banned, data.bannedAt, data.banned_at),
  }
}

function parseUnit(value: unknown): RemoteUnit | null {
  const data = record(value)
  const key = str(data.key)
  if (!key || !isUnitKey(key)) return null
  return {
    key,
    title: text(data.title) ?? key,
    headRev: num(data.headRev) ?? num(data.head_rev) ?? num(data.head) ?? 0,
    archived: flag(data.archived, data.archivedAt, data.archived_at),
    banned: flag(data.banned, data.bannedAt, data.banned_at),
    manifest: parseManifest(data.sourceManifest ?? data.source_manifest ?? data.source),
    systemRev: num(data.systemRev) ?? num(data.system_rev) ?? null,
  }
}

/** Retry on no answer and on 5xx: 3 retries with backoff. */
async function withRetries<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const status = error instanceof CloudError ? error.status : 0
      const retriable = status === 0 || (status >= 500 && status !== 507)
      if (!retriable || attempt >= retries) throw error
      await sleep(500 * 2 ** attempt)
    }
  }
}

export class CloudClient {
  constructor(
    readonly host: string,
    private readonly token: string | null,
  ) {}

  private async send(method: string, path: string, init: { body?: BodyInit; type?: string; timeout: number }) {
    const headers: Record<string, string> = {
      'User-Agent': `foss-design/${packageVersion()} (${os.platform()})`,
      Accept: 'application/json',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (init.type) headers['Content-Type'] = init.type
    try {
      return await fetch(`${this.host}/api${path}`, {
        method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(init.timeout),
      })
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause
      const reason =
        (error as Error).name === 'TimeoutError'
          ? 'timed out'
          : (cause?.code ?? cause?.message ?? (error as Error).message)
      throw new CloudError(`Could not reach ${this.host}: ${reason}`, 0, 'network')
    }
  }

  private async fail(response: Response): Promise<never> {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {}
    throw errorFor(this.host, response.status, body, response.headers.get('retry-after'))
  }

  /** JSON in, JSON out; any non-2xx answer throws a CloudError. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      type: body === undefined ? undefined : 'application/json',
      timeout: JSON_TIMEOUT,
    })
    if (!response.ok) await this.fail(response)
    if (response.status === 204) return null as T
    const text = await response.text()
    if (!text) return null as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new CloudError(`${this.host} answered ${method} ${path} with something other than JSON`, 0, 'bad_response')
    }
  }

  /** POST /device/code. */
  deviceCode(hostname: string): Promise<DeviceCode> {
    return this.request<DeviceCode>('POST', '/device/code', { client_name: clientName(), hostname })
  }

  /** POST /device/token: the token, or the RFC 8628 error code while it is not there yet. */
  async deviceToken(deviceCode: string): Promise<{ token: string } | { error: string; message?: string }> {
    const response = await this.send('POST', '/device/token', {
      body: JSON.stringify({ device_code: deviceCode }),
      type: 'application/json',
      timeout: JSON_TIMEOUT,
    })
    let body: Record<string, unknown> = {}
    try {
      body = record(await response.json())
    } catch {}
    const token = str(body.access_token)
    if (response.ok && token) return { token }
    const error = str(body.error)
    if (error) return { error, message: text(body.message) ?? text(body.error_description) }
    return this.fail(response)
  }

  async me(): Promise<Me> {
    const body = record(await this.request('GET', '/me'))
    const user = record(body.user ?? body)
    return { email: text(user.email) ?? '', name: text(user.name) }
  }

  async projects(): Promise<{ owned: RemoteProject[]; shared: RemoteProject[] }> {
    const body = record(await this.request('GET', '/projects'))
    const list = (value: unknown, role: string) =>
      (Array.isArray(value) ? value : [])
        .map((item) => parseProject(item, role))
        .filter((item): item is RemoteProject => item !== null)
    return { owned: list(body.owned, 'owner'), shared: list(body.shared, 'member') }
  }

  async createProject(name: string): Promise<RemoteProject> {
    const body = record(await this.request('POST', '/projects', { name }))
    const project = parseProject(body.project ?? body, 'owner')
    if (!project) throw new CloudError(`${this.host} did not return the new project`, 0, 'bad_response')
    return project
  }

  async units(projectId: string): Promise<Map<string, RemoteUnit>> {
    const body = await this.request('GET', `/projects/${encodeURIComponent(projectId)}/units`)
    const list = Array.isArray(body) ? body : record(body).units
    const units = new Map<string, RemoteUnit>()
    for (const item of Array.isArray(list) ? list : []) {
      const unit = parseUnit(item)
      if (unit) units.set(unit.key, unit)
    }
    return units
  }

  /** POST /blobs/missing, in batches: the hashes the cloud does not have yet. */
  async missing(projectId: string, hashes: string[]): Promise<string[]> {
    const missing: string[] = []
    for (let start = 0; start < hashes.length; start += 1000) {
      const body = record(
        await this.request('POST', `/projects/${encodeURIComponent(projectId)}/blobs/missing`, {
          hashes: hashes.slice(start, start + 1000),
        }),
      )
      if (Array.isArray(body.missing)) missing.push(...body.missing.filter((hash) => typeof hash === 'string'))
    }
    return missing
  }

  putBlob(projectId: string, hash: string, data: Buffer): Promise<void> {
    return withRetries(async () => {
      const response = await this.send('PUT', `/projects/${encodeURIComponent(projectId)}/blobs/${hash}`, {
        body: new Uint8Array(data),
        type: 'application/octet-stream',
        timeout: BLOB_TIMEOUT,
      })
      if (!response.ok) await this.fail(response)
      await response.arrayBuffer().catch(() => {})
    })
  }

  getBlob(projectId: string, hash: string): Promise<Buffer> {
    return withRetries(async () => {
      const response = await this.send('GET', `/projects/${encodeURIComponent(projectId)}/blobs/${hash}`, {
        timeout: BLOB_TIMEOUT,
      })
      if (!response.ok) await this.fail(response)
      const data = Buffer.from(await response.arrayBuffer())
      if (hashBuffer(data) !== hash)
        throw new CloudError(`Blob ${hash.slice(0, 12)} arrived damaged (hash mismatch)`, 0, 'bad_blob')
      return data
    })
  }

  /** POST /push: the new head of every pushed unit. */
  async push(projectId: string, units: PushUnit[]): Promise<Map<string, number>> {
    const body = await this.request('POST', `/projects/${encodeURIComponent(projectId)}/push`, { units })
    const data = record(body)
    const list = Array.isArray(body) ? body : (data.units ?? data.results)
    const revs = new Map<string, number>()
    for (const item of Array.isArray(list) ? list : []) {
      const entry = record(item)
      const key = str(entry.key)
      const rev = num(entry.rev) ?? num(entry.headRev)
      if (key && rev !== undefined) revs.set(key, rev)
    }
    return revs
  }
}
