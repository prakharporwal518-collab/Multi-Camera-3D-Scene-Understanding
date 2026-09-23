import { useRef, useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextInput } from '@/components/ui/Form'
import { Icon } from '@/components/ui/Icon'
import { ProgressBar } from '@/components/ui/Progress'
import { ErrorNotice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { api } from '@/services/api'
import type { Camera } from '@/types/project'
import { fmtBytes } from '@/utils/format'
import {
  IMAGE_EXTENSIONS,
  MAX_FILES_PER_REQUEST,
  VIDEO_EXTENSIONS,
  parseNumber,
  validateImageFiles,
  validateVideoFile,
  type FileIssue,
  type UploadLimits,
} from '@/utils/validation'
import s from './cameras.module.css'

interface UploadControlsProps {
  camera: Camera
  limits: UploadLimits
  disabled: boolean
  onUploaded: (camera: Camera) => void
}

export function UploadControls({ camera, limits, disabled, onUploaded }: UploadControlsProps) {
  const toast = useToast()
  const imageInput = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null)
  const [issues, setIssues] = useState<FileIssue[]>([])
  const [error, setError] = useState<unknown>(null)
  const [dragging, setDragging] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const busy = progress !== null

  const uploadImages = async (files: File[]) => {
    setError(null)
    const check = validateImageFiles(files, camera.frameCount, limits)
    setIssues(check.rejected)
    if (check.accepted.length === 0) return
    let current = camera
    let added = 0
    const serverIssues: FileIssue[] = []
    try {
      // Large selections are sent in batches that respect the server's per-request limit.
      for (let i = 0; i < check.accepted.length; i += MAX_FILES_PER_REQUEST) {
        const batch = check.accepted.slice(i, i + MAX_FILES_PER_REQUEST)
        const done = i / check.accepted.length
        setProgress({ label: `Uploading ${i + 1}–${i + batch.length} of ${check.accepted.length}…`, value: done })
        const res = await api.uploadImages(current.id, batch, {
          onProgress: (f) => setProgress((p) => p && { ...p, value: done + (f * batch.length) / check.accepted.length }),
        })
        current = res.camera
        added += res.added
        res.skipped.forEach((sk) => serverIssues.push({ file: sk.file ?? 'file', reason: sk.message }))
      }
      toast.show('ok', `${added} frame${added === 1 ? '' : 's'} added to ${camera.label}`)
    } catch (err) {
      setError(err)
    } finally {
      setProgress(null)
      setIssues((prev) => [...prev, ...serverIssues])
      if (current !== camera) onUploaded(current)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (disabled || busy) return
    void uploadImages(Array.from(e.dataTransfer.files))
  }

  return (
    <div className={s.actions} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div
        className={s.dropzone}
        data-active={dragging}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Icon name="upload" size={20} />
        <span>Drop images here, or</span>
        <div className={s.actions} style={{ justifyContent: 'center' }}>
          <Button
            size="sm"
            icon="images"
            disabled={disabled || busy || camera.sourceKind === 'video'}
            onClick={() => imageInput.current?.click()}
          >
            Choose images
          </Button>
          <Button size="sm" icon="video" disabled={disabled || busy || camera.frameCount > 0} onClick={() => setVideoOpen(true)}>
            Upload video
          </Button>
        </div>
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {IMAGE_EXTENSIONS.join(', ')} up to {limits.maxImageMb} MB each · {limits.maxFramesPerCamera} frames per camera
        </span>
        <input
          ref={imageInput}
          type="file"
          multiple
          hidden
          accept={IMAGE_EXTENSIONS.map((e) => `.${e}`).join(',')}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) void uploadImages(files)
          }}
        />
      </div>
      {camera.sourceKind === 'video' && <p className="faint">Frames came from a video. Clear them to upload images instead.</p>}
      {progress && <ProgressBar value={progress.value} label={progress.label} />}
      {progress && <span className="muted">{progress.label}</span>}
      {error !== null && <ErrorNotice error={error} title="Upload failed" />}
      {issues.length > 0 && (
        <ErrorNotice
          tone="warn"
          error={new Error(`${issues.length} file${issues.length === 1 ? ' was' : 's were'} not added`)}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setIssues([])}>
              Dismiss
            </Button>
          }
        />
      )}
      {issues.length > 0 && (
        <ul className={s.rejected}>
          {issues.slice(0, 12).map((i, k) => (
            <li key={k}>
              <span className="mono">{i.file}</span>: {i.reason}
            </li>
          ))}
          {issues.length > 12 && <li>…and {issues.length - 12} more</li>}
        </ul>
      )}
      <VideoDialog
        open={videoOpen}
        camera={camera}
        limits={limits}
        onClose={() => setVideoOpen(false)}
        onUploaded={(c, added, note) => {
          toast.show('ok', `${added} frames extracted for ${camera.label}`, note)
          onUploaded(c)
        }}
      />
    </div>
  )
}

function VideoDialog({ open, camera, limits, onClose, onUploaded }: {
  open: boolean
  camera: Camera
  limits: UploadLimits
  onClose: () => void
  onUploaded: (camera: Camera, added: number, note?: string) => void
}) {
  const [file, setFile] = useState<File | undefined>()
  const [stride, setStride] = useState('1')
  const [touched, setTouched] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const fileError = touched ? validateVideoFile(file, limits) : null
  const strideCheck = parseNumber(stride, { label: 'Frame stride', min: 1, max: 100, integer: true, required: true })

  const submit = async () => {
    setTouched(true)
    if (validateVideoFile(file, limits) || strideCheck.error || !file) return
    setError(null)
    setProgress(0)
    try {
      const res = await api.uploadVideo(camera.id, file, strideCheck.value!, { onProgress: setProgress })
      onUploaded(res.camera, res.added, res.skipped[0]?.message)
      setFile(undefined)
      setTouched(false)
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog
      open={open}
      title={`Upload video for ${camera.label}`}
      onClose={() => progress === null && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={progress !== null}>
            Cancel
          </Button>
          <Button variant="primary" icon="upload" loading={progress !== null} onClick={submit}>
            Upload and extract
          </Button>
        </>
      }
    >
      <div>
        <input
          type="file"
          accept={VIDEO_EXTENSIONS.map((e) => `.${e}`).join(',')}
          aria-label="Video file"
          aria-invalid={Boolean(fileError) || undefined}
          onChange={(e) => {
            setFile(e.target.files?.[0])
            setTouched(true)
          }}
        />
        {file && (
          <p className="faint" style={{ marginTop: 4 }}>
            {file.name} · {fmtBytes(file.size)}
          </p>
        )}
        {fileError && <p style={{ color: 'var(--err)', fontSize: 'var(--fs-xs)', marginTop: 4 }}>{fileError}</p>}
      </div>
      <TextInput
        label="Frame stride"
        help={`Keep every n-th frame. At most ${limits.maxFramesPerCamera} frames are extracted.`}
        inputMode="numeric"
        value={stride}
        error={touched ? strideCheck.error : null}
        onChange={setStride}
      />
      {progress !== null && (
        <>
          <ProgressBar value={progress < 1 ? progress : undefined} label="Video upload" />
          <span className="muted">{progress < 1 ? 'Uploading…' : 'Processing frames…'}</span>
        </>
      )}
      {error !== null && <ErrorNotice error={error} title="The video could not be processed" />}
    </Dialog>
  )
}
