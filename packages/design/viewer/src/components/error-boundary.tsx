import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { useViewer } from '../lib/viewer'
import { Button, ButtonLink } from '../ui/button'
import { Notice } from '../ui/page'

function Failed({ error }: { error: Error }) {
  const scoped = !!useViewer().scope
  return (
    <Notice
      title="This page failed to show"
      text={<span className="font-mono text-[12.5px] break-words">{error.message.slice(0, 500)}</span>}
      action={
        <>
          <Button onClick={() => window.location.reload()}>Reload</Button>
          {scoped ? null : <ButtonLink to="/">All canvases</ButtonLink>}
        </>
      }
    />
  )
}

class Boundary extends Component<{ at: string; children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[design] a page failed to render', error, info.componentStack)
  }

  override componentDidUpdate(previous: { at: string }) {
    // Another address gets another try.
    if (this.state.error && previous.at !== this.props.at) this.setState({ error: null })
  }

  override render() {
    return this.state.error ? <Failed error={this.state.error} /> : this.props.children
  }
}

/** One page that throws shows what went wrong in its place, instead of blanking the whole viewer. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation()
  return <Boundary at={location}>{children}</Boundary>
}
