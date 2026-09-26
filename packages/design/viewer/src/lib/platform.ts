export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** The shortcut modifier as the user's keyboard labels it. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'
