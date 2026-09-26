import { ButtonLink } from '../ui/button'
import { Notice } from '../ui/page'

export function NotFound({ title = 'Nothing here', text }: { title?: string; text?: string }) {
  return (
    <Notice
      title={title}
      text={text ?? 'This address does not match a canvas or a page of the design system.'}
      action={<ButtonLink to="/">All canvases</ButtonLink>}
    />
  )
}
