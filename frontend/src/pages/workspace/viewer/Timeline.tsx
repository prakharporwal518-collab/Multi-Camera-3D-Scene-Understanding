import type { SceneDocument } from '@/types/scene'
import { fmtNumber } from '@/utils/format'
import s from '../page.module.css'

/** Scrubber over the synchronized timesteps that have detections. */
export function Timeline({ scene, index, onChange }: { scene: SceneDocument; index: number; onChange: (i: number) => void }) {
  if (scene.frames.length < 2) return null
  const frame = scene.frames[index]
  const last = scene.frames.length - 1
  return (
    <div className={s.timeline}>
      <span className="faint num">t = {fmtNumber(scene.frames[0].t, 1)} s</span>
      <input
        type="range"
        min={0}
        max={last}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Timestep"
        aria-valuetext={`Timestep ${index + 1} of ${last + 1}, t = ${fmtNumber(frame?.t, 2)} seconds`}
      />
      <span className="num">
        {index + 1}/{last + 1} · t = {fmtNumber(frame?.t, 1)} s
      </span>
    </div>
  )
}
