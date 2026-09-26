/** Frame presets, in CSS pixels. */
export const DEVICES = {
  phone: { width: 390, height: 844, label: 'Phone' },
  'phone-sm': { width: 375, height: 667, label: 'Phone S' },
  'phone-lg': { width: 430, height: 932, label: 'Phone L' },
  tablet: { width: 834, height: 1194, label: 'Tablet' },
  'tablet-landscape': { width: 1194, height: 834, label: 'Tablet landscape' },
  laptop: { width: 1280, height: 800, label: 'Laptop' },
  desktop: { width: 1440, height: 900, label: 'Desktop' },
  wide: { width: 1920, height: 1080, label: 'Wide' },
} as const

export type DeviceName = keyof typeof DEVICES

export const DEVICE_NAMES = Object.keys(DEVICES) as [DeviceName, ...DeviceName[]]

export const DEFAULT_DEVICE: DeviceName = 'desktop'
