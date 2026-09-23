import { useState } from 'react'
import type { SceneCamera, SceneObject } from '@/types/scene'
import { classColor } from '@/utils/palette'

interface BoxOverlayProps {
  camera: SceneCamera
  src: string
  objects: SceneObject[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Frame with the 2D boxes that were associated with 3D objects (native pixel coordinates). */
export function BoxOverlay({ camera, src, objects, selectedId, onSelect }: BoxOverlayProps) {
  const [failed, setFailed] = useState(false)
  const visible = objects.filter((o) => o.boxes[camera.label])
  return (
    <div style={{ position: 'relative', aspectRatio: `${camera.width} / ${camera.height}`, background: '#0f1113', borderRadius: 4, overflow: 'hidden' }}>
      {failed ? (
        <p className="faint" style={{ padding: 16 }}>
          The frame could not be loaded.
        </p>
      ) : (
        <img src={src} alt={`${camera.label} frame`} style={{ width: '100%', height: '100%', display: 'block' }} onError={() => setFailed(true)} />
      )}
      <svg
        viewBox={`0 0 ${camera.width} ${camera.height}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        role="group"
        aria-label={`${visible.length} detections in ${camera.label}`}
      >
        {visible.map((o) => {
          const [x1, y1, x2, y2] = o.boxes[camera.label]
          const selected = o.id === selectedId
          const color = selected ? '#ffffff' : classColor(o.class)
          const label = `${o.trackId !== null ? `#${o.trackId} ` : ''}${o.class} ${Math.round(o.confidence * 100)}%`
          return (
            <g
              key={o.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${label}`}
              aria-pressed={selected}
              onClick={() => onSelect(o.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(o.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill={selected ? 'rgb(255 255 255 / 0.08)' : 'transparent'} stroke={color} strokeWidth={selected ? 3 : 2} vectorEffect="non-scaling-stroke" />
              <rect x={x1} y={Math.max(0, y1 - 22)} width={label.length * 8.5 + 10} height={20} fill="rgb(15 17 19 / 0.85)" />
              <text x={x1 + 5} y={Math.max(0, y1 - 22) + 15} fill={color} fontSize={14} fontFamily="IBM Plex Mono, monospace">
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
