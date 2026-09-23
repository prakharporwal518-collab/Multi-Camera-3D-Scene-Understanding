import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { ApiError } from '@/services/apiClient'
import type { Camera } from '@/types/project'
import { DEFAULT_LIMITS } from '@/utils/validation'
import { UploadControls } from './UploadControls'

vi.mock('@/services/api', () => ({ api: { uploadImages: vi.fn(), uploadVideo: vi.fn() } }))
const { api } = await import('@/services/api')

const camera: Camera = {
  id: 'c1',
  projectId: 'p1',
  label: 'CAM-01',
  name: 'Gate',
  sourceKind: null,
  width: null,
  height: null,
  fps: null,
  frameCount: 0,
  status: 'empty',
  calibration: null,
  createdAt: '2026-01-01T00:00:00Z',
}

function setup(onUploaded = vi.fn()) {
  const { container } = render(
    <ToastProvider>
      <UploadControls camera={camera} limits={DEFAULT_LIMITS} disabled={false} onUploaded={onUploaded} />
    </ToastProvider>,
  )
  const input = container.querySelector('input[type="file"][multiple]') as HTMLInputElement
  return { input, onUploaded }
}

describe('UploadControls', () => {
  beforeEach(() => {
    vi.mocked(api.uploadImages).mockReset()
  })

  it('rejects invalid files before anything is uploaded', async () => {
    const { input } = setup()
    await userEvent.upload(input, [new File(['x'], 'notes.txt'), new File([], 'empty.png')], { applyAccept: false })
    expect(api.uploadImages).not.toHaveBeenCalled()
    expect(screen.getByText('2 files were not added')).toBeInTheDocument()
    expect(screen.getByText(/not supported images/)).toBeInTheDocument()
  })

  it('uploads only the valid files and reports the result', async () => {
    vi.mocked(api.uploadImages).mockResolvedValue({ camera: { ...camera, frameCount: 1, status: 'ready' }, added: 1, skipped: [] })
    const { input, onUploaded } = setup()
    await userEvent.upload(input, [new File(['img'], 'a.jpg'), new File(['x'], 'b.gif')], { applyAccept: false })
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    const sent = vi.mocked(api.uploadImages).mock.calls[0][1]
    expect(sent.map((f) => f.name)).toEqual(['a.jpg'])
    expect(await screen.findByText('1 frame added to CAM-01')).toBeInTheDocument()
  })

  it('shows the server explanation when the upload fails', async () => {
    const failure = new ApiError('network', 'The processing server (api) could not be reached.')
    vi.mocked(api.uploadImages).mockImplementation(() => Promise.reject(failure))
    const { input } = setup()
    await userEvent.upload(input, [new File(['img'], 'a.png')], { applyAccept: false })
    expect(await screen.findByText('Upload failed')).toBeInTheDocument()
    expect(screen.getByText(/could not be reached/)).toBeInTheDocument()
  })
})
