import { z } from 'zod'
import { DEVICE_NAMES } from '../shared/devices'
import { routeError } from '../shared/routes'

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'use letters, digits, "-" and "_", starting with a letter or digit')
const theme = z.enum(['light', 'dark'])
/** The app URL(s) a screen stands for; links to them open it. */
const route = z.union([z.string(), z.array(z.string()).min(1)]).superRefine((value, ctx) => {
  for (const pattern of Array.isArray(value) ? value : [value]) {
    const error = routeError(pattern)
    if (error) ctx.addIssue({ code: 'custom', message: error })
  }
})
const position = { x: z.number().optional(), y: z.number().optional() }
const size = {
  device: z.enum(DEVICE_NAMES).optional(),
  width: z.number().int().min(80).max(8000).optional(),
  height: z.union([z.number().int().min(80).max(40000), z.literal('auto')]).optional(),
}

/** `.design/design.json`, all optional. */
export const DesignConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  name: z.string().min(1).optional(),
  /** Import aliases for screens, relative to the project root: `{ "@/": "src/" }`. */
  alias: z.record(z.string(), z.string()).optional(),
  /** Extra folders Tailwind scans for class names, relative to the project root. */
  sources: z.array(z.string()).optional(),
  /** A monorepo's app package, relative to the project root: screens import its dependencies and its React. */
  app: z.string().min(1).optional(),
  /** A folder served at the root of every screen, like Vite's `public`, relative to the project root. */
  public: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
})
export type DesignConfig = z.infer<typeof DesignConfigSchema>

/** `.design/system/system.json`. */
export const SystemConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Stylesheet URLs every screen loads, such as Google Fonts. */
  fonts: z.array(z.string().url()).optional(),
  /** A stylesheet that replaces the default Tailwind + tokens.css entry, relative to the system folder. */
  stylesheet: z.string().optional(),
  /** Text the typography specimen sets. */
  sample: z.string().optional(),
})
export type SystemConfig = z.infer<typeof SystemConfigSchema>

export const ScreenItemSchema = z.strictObject({
  type: z.literal('screen'),
  id: id.optional(),
  src: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  theme: theme.optional(),
  /** Inject the design system stylesheet; defaults to the canvas setting. */
  system: z.boolean().optional(),
  route: route.optional(),
  ...size,
  ...position,
})

export const UrlItemSchema = z.strictObject({
  type: z.literal('url'),
  id: id.optional(),
  url: z.string().regex(/^https?:\/\//, 'must be an http(s) URL'),
  title: z.string().optional(),
  description: z.string().optional(),
  route: route.optional(),
  ...size,
  ...position,
})

export const NoteItemSchema = z.strictObject({
  type: z.literal('note'),
  id: id.optional(),
  text: z.string(),
  title: z.string().optional(),
  width: z.number().int().min(80).max(4000).optional(),
  tone: z.enum(['note', 'plain']).optional(),
  ...position,
})

export const ImageItemSchema = z.strictObject({
  type: z.literal('image'),
  id: id.optional(),
  src: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  width: z.number().int().min(16).max(8000).optional(),
  ...position,
})

/** Items without a `type` are screens. */
export const ItemSchema = z.preprocess(
  (value) =>
    value && typeof value === 'object' && !Array.isArray(value) && !('type' in value)
      ? { type: 'screen', ...value }
      : value,
  z.discriminatedUnion('type', [ScreenItemSchema, UrlItemSchema, NoteItemSchema, ImageItemSchema]),
)
export type ItemInput = z.infer<typeof ItemSchema>

export const SectionSchema = z.strictObject({
  id: id.optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  columns: z.number().int().min(1).max(50).optional(),
  items: z.array(z.unknown()),
})

export const PageSchema = z
  .strictObject({
    id: id,
    title: z.string().min(1),
    description: z.string().optional(),
    sections: z.array(z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
  })
  .refine((page) => !(page.sections && page.items), 'a page has either "sections" or free-layout "items", not both')

export const CanvasSchema = z.strictObject({
  $schema: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  /** Inject the design system stylesheet into screens (default true). */
  system: z.boolean().optional(),
  /** Theme screens open in (default follows the viewer). */
  theme: theme.optional(),
  /** The canvas's picture in lists: a screen id, or an image in the canvas folder (PNG, JPEG, WebP, SVG, 512 KB). */
  cover: z.string().min(1).optional(),
  pages: z.array(z.unknown()).min(1, 'add at least one page'),
})

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i

/** `pages[0].sections[1]` from a zod issue path. */
export function formatPath(base: string, path: readonly PropertyKey[]): string {
  let out = base
  for (const part of path) out += typeof part === 'number' ? `[${part}]` : out ? `.${String(part)}` : String(part)
  return out
}

export function describeZodError(error: z.ZodError, base = ''): { at: string; message: string }[] {
  return error.issues.map((issue) => ({ at: formatPath(base, issue.path), message: issue.message }))
}
