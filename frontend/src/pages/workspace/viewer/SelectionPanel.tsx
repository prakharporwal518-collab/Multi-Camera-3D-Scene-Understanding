import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { KeyValue } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/States'
import type { SceneCamera, SceneDocument, SceneObject } from '@/types/scene'
import { capitalise, fmtLength, fmtNumber, fmtPercent, unitLabel } from '@/utils/format'
import { cameraAngles, compassLabel, groundSpeed, headingDeg } from '@/utils/geometry'

function objectVelocity(scene: SceneDocument, object: SceneObject, t: number) {
  const track = scene.tracks.find((tr) => tr.id === object.trackId)
  return track?.states.find((st) => Math.abs(st.t - t) < 1e-6)?.velocity ?? null
}

export function ObjectDetails({ scene, object, t, onClear }: { scene: SceneDocument; object: SceneObject; t: number; onClear: () => void }) {
  const v = objectVelocity(scene, object, t)
  const speed = v ? groundSpeed(v) : null
  const unit = unitLabel(scene)
  return (
    <Panel
      title={object.trackId !== null ? `OBJECT #${object.trackId}` : `Detection ${object.id}`}
      actions={<Button size="sm" variant="ghost" icon="close" label="Clear selection" onClick={onClear} />}
    >
      <KeyValue
        items={[
          ['Class', capitalise(object.class)],
          [
            'Position',
            <span className="num">
              X {fmtNumber(object.center[0], 2)} · Y {fmtNumber(object.center[1], 2)} · Z {fmtNumber(object.center[2], 2)}
            </span>,
          ],
          ['Size (w×h×l)', <span className="num">{object.size.map((d) => fmtNumber(d, 2)).join(' × ')} {unit}</span>],
          [
            'Velocity',
            speed !== null && speed > 0.05 ? (
              <span className="num">
                {fmtNumber(speed, 2)} {unit}/s toward {compassLabel(headingDeg(v!))}
              </span>
            ) : speed !== null ? (
              'Stationary'
            ) : (
              <span className="faint">not tracked</span>
            ),
          ],
          ['Confidence', <span className="num">{fmtPercent(object.confidence)}</span>],
          ['Visible cameras', object.visibleCameras.join(', ')],
          [
            'Localisation',
            object.method === 'multi-view' ? (
              'Triangulated from multiple views'
            ) : (
              <Badge tone="warn" title="Single camera: placed where the bottom of the box meets the ground plane">
                Ground contact, 1 view
              </Badge>
            ),
          ],
        ]}
      />
      <p className="faint" style={{ marginTop: 8, fontSize: 'var(--fs-xs)' }}>
        The extent along the viewing direction is not observable from 2D boxes; length is set equal to width.
      </p>
    </Panel>
  )
}

export function CameraDetails({ scene, camera, onLookThrough, onClear }: { scene: SceneDocument; camera: SceneCamera; onLookThrough: () => void; onClear: () => void }) {
  const angles = camera.pose ? cameraAngles(camera.pose) : null
  return (
    <Panel title={camera.label} actions={<Button size="sm" variant="ghost" icon="close" label="Clear selection" onClick={onClear} />}>
      <KeyValue
        items={[
          ['Name', camera.name],
          ['Position', camera.pose ? <span className="num">{camera.pose.position.map((x) => fmtNumber(x, 2)).join(', ')}</span> : '—'],
          ['Yaw / pitch', angles ? <span className="num">{fmtNumber(angles.yaw, 1)}° / {fmtNumber(angles.pitch, 1)}°</span> : '—'],
          ['Vertical FOV', <span className="num">{fmtNumber(camera.fovY, 1)}°</span>],
          ['Resolution', <span className="num">{camera.width} × {camera.height}</span>],
          ['Height above ground', scene.groundAligned && camera.pose ? fmtLength(camera.pose.position[1], scene) : '—'],
        ]}
      />
      {camera.pose && (
        <Button size="sm" icon="viewer" onClick={onLookThrough} style={{ marginTop: 10 }}>
          View through {camera.label}
        </Button>
      )}
    </Panel>
  )
}

export function NothingSelected() {
  return (
    <Panel title="Selection">
      <EmptyState compact icon="target" title="Nothing selected">
        Click a bounding box or a camera in the viewport.
      </EmptyState>
    </Panel>
  )
}
