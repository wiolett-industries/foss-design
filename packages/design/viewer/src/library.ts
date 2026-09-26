// `foss-design/viewer`: the viewer and its UI kit for apps that embed them.
// Styles come separately, from `foss-design/viewer/styles.css`.
import './styles.css'

export type {
  AssetDoc,
  CanvasDoc,
  CanvasItem,
  CanvasPage,
  CanvasSection,
  CanvasSummary,
  ComponentDoc,
  FrameSize,
  GuidelineDoc,
  ImageItem,
  Issue,
  NoteItem,
  ProjectInfo,
  ScreenItem,
  SystemDoc,
  SystemSummary,
  Theme,
  Token,
  TokenKind,
  TokenValue,
  UrlItem,
} from '@shared/types'
export { DesignViewer, type DesignViewerProps } from './app'
export { SlidePanel } from './components/slide-panel'
export { ThemeMenu } from './components/theme-menu'
export { Bar } from './components/topbar'
export { Mark, Wordmark } from './components/wordmark'
export { cn } from './lib/cn'
export { copyText } from './lib/copy'
export { ApiError, localSource, resolveUrl, staticSource, type ViewerSource } from './lib/source'
export { setThemePref, type ThemePref, useTheme, useThemePref } from './lib/theme'
export type { ViewerScope, ViewerSlots } from './lib/viewer'
export { Avatar, initials } from './ui/avatar'
export { Badge, Count, type Tone } from './ui/badge'
export {
  Button,
  ButtonAnchor,
  type ButtonKind,
  ButtonLink,
  type ButtonProps,
  buttonClass,
  IconButton,
  type IconButtonProps,
  iconButtonClass,
} from './ui/button'
export { Segmented, Switch } from './ui/choice'
export { Dialog } from './ui/dialog'
export { Icon, type IconName } from './ui/icon'
export { floatingSurface, Menu, MenuItem, MenuLabel, MenuSeparator, menuItemClass, menuSurface } from './ui/menu'
export { Meter } from './ui/meter'
export { Content, type NavItem, NavLabel, Notice, NoticeCard, PageHead, SubNav } from './ui/page'
export {
  GroupRow,
  KV,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  PanelTabs,
  Row,
  RowLink,
  type RowProps,
  Strip,
  THead,
} from './ui/panel'
export { Kbd, Mono, Muted, Two } from './ui/text'
export { TextArea, type TextAreaProps, TextField, type TextFieldProps } from './ui/text-field'
export { Toaster, type ToastTone, toast } from './ui/toast'
export { Tooltip, TooltipProvider } from './ui/tooltip'
