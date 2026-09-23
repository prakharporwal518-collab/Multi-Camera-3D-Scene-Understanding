import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/apiClient'
import { ErrorBoundary } from './ErrorBoundary'
import { StatusPill } from './StatusPill'
import { Button } from './ui/Button'
import { EmptyState, ErrorNotice } from './ui/States'
import { ToastProvider, useToast } from './ui/Toast'

describe('ErrorNotice', () => {
  it('shows the message, the hint and technical details on request', async () => {
    const onRetry = vi.fn()
    const err = new ApiError('http', 'Reconstruction could not start.', { status: 422, code: 'insufficient_matches', hint: 'Add overlapping frames.' })
    render(<ErrorNotice error={err} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Reconstruction could not start.')
    expect(screen.getByText('Add overlapping frames.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByText(/code: insufficient_matches/)).toBeInTheDocument()
  })

  it('handles plain errors and unknown values', () => {
    render(<ErrorNotice error="something odd" />)
    expect(screen.getByRole('alert')).toHaveTextContent('something odd')
  })
})

describe('EmptyState', () => {
  it('renders a title, explanation and actions', () => {
    render(
      <EmptyState title="No reconstruction available yet." actions={<Button>Start Reconstruction</Button>}>
        Add frames first.
      </EmptyState>,
    )
    expect(screen.getByText('No reconstruction available yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Reconstruction' })).toBeInTheDocument()
  })
})

describe('StatusPill', () => {
  it.each([
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['warning', 'Warning'],
    ['skipped', 'Skipped'],
    ['processing', 'Processing'],
  ] as const)('labels %s with text, not only colour', (status, text) => {
    render(<StatusPill status={status} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('render failed')
  }

  it('contains a crash to its area and can recover', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let crash = true
    function Maybe() {
      return crash ? <Boom /> : <p>recovered</p>
    }
    render(
      <div>
        <p>outside</p>
        <ErrorBoundary area="3D viewer">
          <Maybe />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('outside')).toBeInTheDocument()
    expect(screen.getByText('The 3D viewer stopped working')).toBeInTheDocument()
    crash = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
    spy.mockRestore()
  })
})

describe('Toast', () => {
  function Trigger() {
    const toast = useToast()
    return <button onClick={() => toast.show('err', 'Upload failed', 'Network error')}>go</button>
  }

  it('announces errors and lets the user dismiss them', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByText('go'))
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
  })
})

describe('Button', () => {
  it('uses the label as accessible name for icon-only buttons and blocks clicks while loading', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button icon="close" label="Close dialog" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClick).toHaveBeenCalledOnce()
    rerender(<Button loading onClick={onClick}>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
