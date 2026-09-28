import type { RuntimeMessage } from '@shared/types'

/**
 * Frames run code anyone who can push wrote, and any of them may post the viewer anything: a
 * message only reaches the viewer's handlers with the fields its type has, of their types.
 * Strings are cut and sizes kept within reason, so a frame cannot swell the viewer's state.
 */
export const MAX_FRAME_SIZE = 100_000
export const MAX_FRAME_ERRORS = 20
const MAX_TEXT = 2000

type Data = Record<string, unknown>

const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const optional =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || check(value)
const listOf =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(check)
const shape =
  (fields: Record<string, (value: unknown) => boolean>) =>
  (value: unknown): value is Data =>
    isObject(value) && Object.entries(fields).every(([key, check]) => check(value[key]))

const isPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && isString(value[0]) && isString(value[1])
const isBox = (value: unknown) => Array.isArray(value) && value.length === 4 && value.every(isNumber)
const isCrumb = shape({ ref: isNumber, label: isString })
const isColor = shape({ value: isString, css: isString, token: optional(isString) })
const isTokenValue = shape({ value: isString, token: optional(isString) })

const isElementInfo = shape({
  ref: isNumber,
  tag: isString,
  label: isString,
  text: optional(isString),
  classes: listOf(isString),
  attributes: listOf(isPair),
  component: optional(shape({ owners: listOf(isString), file: optional(isString) })),
  rect: shape({ x: isNumber, y: isNumber, w: isNumber, h: isNumber }),
  margin: isBox,
  border: isBox,
  padding: isBox,
  layout: listOf(isPair),
  typography: optional(
    shape({
      family: isString,
      familyToken: optional(isString),
      size: isString,
      sizeToken: optional(isString),
      weight: isString,
      lineHeight: isString,
      letterSpacing: isString,
      color: isColor,
      align: isString,
      transform: optional(isString),
    }),
  ),
  appearance: shape({
    background: optional(isColor),
    backgroundImage: optional(isString),
    border: optional(shape({ width: isString, style: isString, color: isColor })),
    radius: optional(isTokenValue),
    shadow: optional(isTokenValue),
    opacity: optional(isString),
  }),
  path: listOf(isCrumb),
  children: listOf(isCrumb),
  css: isString,
})

/** What each message type carries besides `source`, `key` and `type`. */
const FIELDS: Record<RuntimeMessage['type'], Record<string, (value: unknown) => boolean>> = {
  ready: {},
  blur: {},
  updated: {},
  'inspect-escape': {},
  size: { width: isNumber, height: isNumber },
  error: { message: isString },
  go: { target: isString },
  link: {
    href: isString,
    path: (value) => value === null || isString(value),
    form: isBoolean,
    raw: optional(isString),
    pushed: optional(isBoolean),
  },
  wheel: { deltaX: isNumber, deltaY: isNumber, x: isNumber, y: isNumber, zoom: isBoolean },
  keydown: { code: isString },
  pointer: { x: isNumber, y: isNumber, down: isBoolean },
  key: { name: isString, down: isBoolean },
  inspect: { info: (value) => value === null || isElementInfo(value) },
}

const clamp = (value: number) => Math.min(MAX_FRAME_SIZE, Math.max(0, value))

/** `data` as a runtime message, with its sizes and texts bounded; null when it is none. */
export function readRuntimeMessage(data: unknown): RuntimeMessage | null {
  if (!isObject(data) || data.source !== 'design-runtime' || !isString(data.key) || !isString(data.type)) return null
  const fields = Object.hasOwn(FIELDS, data.type) ? FIELDS[data.type as RuntimeMessage['type']] : null
  if (!fields || !shape(fields)(data)) return null
  const message = data as unknown as RuntimeMessage
  if (message.type === 'size') return { ...message, width: clamp(message.width), height: clamp(message.height) }
  if (message.type === 'error') return { ...message, message: message.message.slice(0, MAX_TEXT) }
  return message
}

/** A frame's error list with `message` added: once, and no more than `MAX_FRAME_ERRORS` of them. */
export function withError(list: string[], message: string): string[] {
  return list.includes(message) || list.length >= MAX_FRAME_ERRORS ? list : [...list, message]
}
