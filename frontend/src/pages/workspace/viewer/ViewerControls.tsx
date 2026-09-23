import { Button } from '@/components/ui/Button'
import { Checkbox, Range, Select } from '@/components/ui/Form'
import { Segmented } from '@/components/ui/Segmented'
import type { ColorMode } from '@/three/PointCloudLayer'
import type { ViewPreset } from '@/three/sceneMath'
import { DEFAULT_VIEWER_OPTIONS, type Projection, type ViewerOptions } from '@/three/types'
import { fmtPercent } from '@/utils/format'
import s from '../page.module.css'

type Toggle = Exclude<keyof ViewerOptions, 'pointSize' | 'density' | 'colorMode'>

const TOGGLES: { key: Toggle; label: string }[] = [
  { key: 'showDense', label: 'Dense points' },
  { key: 'showSparse', label: 'Sparse points' },
  { key: 'showCameras', label: 'Cameras' },
  { key: 'showBoxes', label: 'Bounding boxes' },
  { key: 'showLabels', label: 'Labels' },
  { key: 'showTrajectories', label: 'Trajectories' },
  { key: 'showGrid', label: 'Grid' },
  { key: 'showAxes', label: 'Axes' },
  { key: 'showRegions', label: 'Regions' },
]

export function LayerControls({
  options,
  onChange,
  totalDense,
  hide = [],
}: {
  options: ViewerOptions
  onChange: (o: ViewerOptions) => void
  totalDense: number
  hide?: Toggle[]
}) {
  const set = <K extends keyof ViewerOptions>(k: K, v: ViewerOptions[K]) => onChange({ ...options, [k]: v })
  return (
    <div className={s.controlsStack}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="visually-hidden">Visible layers</legend>
        <div className={s.checkGrid}>
          {TOGGLES.filter((t) => !hide.includes(t.key)).map((t) => (
            <Checkbox key={t.key} label={t.label} checked={options[t.key]} onChange={(v) => set(t.key, v)} />
          ))}
        </div>
      </fieldset>
      <Range label="Point size" value={options.pointSize} min={1} max={6} step={0.5} format={(v) => `${v} px`} onChange={(v) => set('pointSize', v)} />
      <Range
        label="Reconstruction density"
        help={`Share of the ${totalDense.toLocaleString('en-US')} dense points drawn`}
        value={options.density}
        min={0.05}
        max={1}
        step={0.05}
        format={(v) => fmtPercent(v, 0)}
        onChange={(v) => set('density', v)}
      />
      <Select
        label="Point colour"
        value={options.colorMode}
        onChange={(v) => set('colorMode', v as ColorMode)}
        options={[
          { value: 'rgb', label: 'Image colour' },
          { value: 'height', label: 'Height (turbo)' },
        ]}
      />
      <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_VIEWER_OPTIONS)}>
        Reset display options
      </Button>
    </div>
  )
}

export function ViewToolbar({
  projection,
  onProjection,
  onPreset,
}: {
  projection: Projection
  onProjection: (p: Projection) => void
  onPreset: (p: ViewPreset) => void
}) {
  return (
    <div className={s.toolbar} role="toolbar" aria-label="View">
      <Button size="sm" icon="refresh" onClick={() => onPreset('perspective')}>
        Reset view
      </Button>
      <Button size="sm" onClick={() => onPreset('top')}>
        Top
      </Button>
      <Button size="sm" onClick={() => onPreset('front')}>
        Front
      </Button>
      <Button size="sm" onClick={() => onPreset('side')}>
        Side
      </Button>
      <span className={s.toolbarSep} aria-hidden="true" />
      <Segmented<Projection>
        label="Projection"
        value={projection}
        onChange={onProjection}
        options={[
          { value: 'perspective', label: 'Persp.', title: 'Perspective projection' },
          { value: 'orthographic', label: 'Ortho.', title: 'Orthographic projection' },
        ]}
      />
    </div>
  )
}

export const INTERACTION_HINT = 'Left-drag rotate · right-drag / shift-drag pan · wheel zoom · click to select'
