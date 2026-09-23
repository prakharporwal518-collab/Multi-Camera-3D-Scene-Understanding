import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import ProjectsPage from './ProjectsPage'

describe('ProjectsPage without a backend', () => {
  it('explains demo-only mode and still offers the demo', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProjectsPage />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText('Demo-only mode')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demo Dataset' })).toHaveAttribute('href', '/projects/demo/overview')
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
  })
})
