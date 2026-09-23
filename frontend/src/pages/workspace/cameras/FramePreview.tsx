import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/Progress'
import { EmptyState } from '@/components/ui/States'
import type { SceneSource } from '@/services/sceneSource'
import { frameSrc, type CameraRow } from './model'
import s from './cameras.module.css'

export function FramePreview({ row, source }: { row: CameraRow; source: SceneSource }) {
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const last = Math.max(0, row.frameCount - 1)

  useEffect(() => setIndex((i) => Math.min(i, last)), [last])
  const src = frameSrc(row, Math.min(index, last), source)
  useEffect(() => setStatus('loading'), [src])

  if (!src) {
    return (
      <div className={s.preview}>
        <div className={s.previewEmpty}>
          <EmptyState compact icon="images" title="No frames yet">
            Upload an image sequence or a video for {row.label}.
          </EmptyState>
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className={s.preview}>
        <img
          src={src}
          alt={`${row.label}, frame ${index + 1} of ${row.frameCount}`}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
          decoding="async"
        />
        <span className={s.previewOverlay}>
          {row.label} · frame {index}
        </span>
        {status === 'loading' && (
          <div className={s.previewEmpty}>
            <Spinner label="Loading frame" />
          </div>
        )}
        {status === 'error' && (
          <div className={s.previewEmpty}>
            <EmptyState compact icon="warning" title="Frame could not be loaded">
              The image request failed. The server may be unreachable.
            </EmptyState>
          </div>
        )}
      </div>
      {row.frameCount > 1 && (
        <div className={s.scrubber}>
          <span className="faint num">0</span>
          <input
            type="range"
            min={0}
            max={last}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            aria-label={`Frame of ${row.label}`}
            aria-valuetext={`Frame ${index} of ${last}`}
          />
          <span className="faint num">{last}</span>
        </div>
      )}
    </div>
  )
}
