import { setThemePref, type ThemePref, useTheme, useThemePref } from '../lib/theme'
import { IconButton } from '../ui/button'
import { Icon, type IconName } from '../ui/icon'
import { Menu, MenuItem, MenuLabel } from '../ui/menu'

const OPTIONS: { value: ThemePref; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

export function ThemeMenu() {
  const pref = useThemePref()
  const theme = useTheme()
  return (
    <Menu align="end" width={180} trigger={<IconButton icon={theme === 'dark' ? 'moon' : 'sun'} label="Appearance" />}>
      <MenuLabel>Appearance</MenuLabel>
      {OPTIONS.map((option) => (
        <MenuItem key={option.value} active={pref === option.value} onSelect={() => setThemePref(option.value)}>
          <Icon name={option.icon} size={15} className="text-ink2" />
          {option.label}
          {pref === option.value ? <Icon name="check" size={15} className="ml-auto text-ink2" /> : null}
        </MenuItem>
      ))}
    </Menu>
  )
}
