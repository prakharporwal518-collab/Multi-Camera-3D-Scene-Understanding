import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '@/types/scene'
import s from './viewer.module.css'

export interface LabelSpec {
  id: string
  position: Vec3
  text: string
  variant?: 'default' | 'selected' | 'measure'
}

export type LabelRefs = MutableRefObject<Map<string, HTMLDivElement>>

/**
 * DOM labels drawn in one overlay next to the canvas. Positions are written imperatively
 * from the render loop, so moving the camera does not re-render React components (and no
 * extra React roots are created, unlike per-label portals).
 */
export function LabelOverlay({ labels, refs }: { labels: LabelSpec[]; refs: LabelRefs }) {
  return (
    <div className={s.labelLayer} aria-hidden="true">
      {labels.map((l) => (
        <div
          key={l.id}
          ref={(el) => {
            if (el) refs.current.set(l.id, el)
            else refs.current.delete(l.id)
          }}
          className={`${s.label} ${l.variant === 'selected' ? s.labelSelected : ''} ${l.variant === 'measure' ? s.labelMeasure : ''}`}
          style={{ visibility: 'hidden' }}
        >
          {l.text}
        </div>
      ))}
    </div>
  )
}

const tmp = new THREE.Vector3()

/** Runs inside the Canvas and projects label anchors to screen space after every render. */
export function LabelProjector({ labels, refs }: { labels: LabelSpec[]; refs: LabelRefs }) {
  const invalidate = useThree((st) => st.invalidate)
  const latest = useRef(labels)
  useEffect(() => {
    latest.current = labels
    invalidate()
  }, [labels, invalidate])

  useFrame(({ camera, size }) => {
    for (const l of latest.current) {
      const el = refs.current.get(l.id)
      if (!el) continue
      tmp.set(l.position[0], l.position[1], l.position[2]).project(camera)
      const visible = tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) <= 1.05 && Math.abs(tmp.y) <= 1.05
      if (!visible) {
        el.style.visibility = 'hidden'
        continue
      }
      const x = ((tmp.x + 1) / 2) * size.width
      const y = ((1 - tmp.y) / 2) * size.height
      el.style.visibility = 'visible'
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -130%)`
    }
  })
  return null
}
