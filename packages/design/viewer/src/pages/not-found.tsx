import { useViewer } from '../lib/viewer'
import { ButtonLink } from '../ui/button'
import { Notice } from '../ui/page'

export function NotFound({ title = 'Nothing here', text }: { title?: string; text?: string }) {
  // A single canvas has no list of canvases to go back to.
  const scoped = !!useViewer().scope
  return (
    <Notice
      title={title}
      text={text ?? 'This address does not match a canvas or a page of the design system.'}
      action={scoped ? undefined : <ButtonLink to="/">All canvases</ButtonLink>}
    />
  )
}
