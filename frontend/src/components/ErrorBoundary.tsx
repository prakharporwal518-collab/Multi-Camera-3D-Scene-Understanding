import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/Button'
import { ErrorNotice } from './ui/States'

interface Props {
  /** Shown in the heading, e.g. "3D viewer" or "Camera Inputs page". */
  area: string
  children: ReactNode
  /** Changing this value resets the boundary (e.g. the current route). */
  resetKey?: unknown
}

interface State {
  error: Error | null
}

/** Contains a rendering failure to one area of the UI instead of blanking the app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area}] render error`, error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 16 }}>
        <ErrorNotice
          error={this.state.error}
          title={`The ${this.props.area} stopped working`}
          actions={
            <Button size="sm" icon="refresh" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }
}
