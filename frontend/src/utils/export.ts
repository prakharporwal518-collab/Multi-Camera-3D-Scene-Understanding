import type { PointCloudData } from '@/services/pointCloud'
import type { SceneDocument } from '@/types/scene'

/** Binary little-endian PLY with per-vertex colour; readable by MeshLab, CloudCompare, Open3D. */
export function buildPly(cloud: PointCloudData, layers: 'all' | 'sparse' | 'dense' = 'all'): Blob {
  const keep: number[] = []
  for (let i = 0; i < cloud.count; i++) {
    const layer = cloud.layers[i]
    if (layers === 'all' || (layers === 'sparse' && layer === 0) || (layers === 'dense' && layer === 1)) keep.push(i)
  }
  const header =
    'ply\nformat binary_little_endian 1.0\ncomment multi-camera-3d-scene-understanding export\n' +
    `element vertex ${keep.length}\nproperty float x\nproperty float y\nproperty float z\n` +
    'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'
  const body = new ArrayBuffer(keep.length * 15)
  const view = new DataView(body)
  keep.forEach((i, n) => {
    const o = n * 15
    view.setFloat32(o, cloud.positions[i * 3], true)
    view.setFloat32(o + 4, cloud.positions[i * 3 + 1], true)
    view.setFloat32(o + 8, cloud.positions[i * 3 + 2], true)
    view.setUint8(o + 12, cloud.colors[i * 3])
    view.setUint8(o + 13, cloud.colors[i * 3 + 1])
    view.setUint8(o + 14, cloud.colors[i * 3 + 2])
  })
  return new Blob([header, body], { type: 'application/octet-stream' })
}

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function tracksCsv(scene: SceneDocument): string {
  const rows = [['track_id', 'class', 't', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'observed', 'cameras']]
  for (const tr of scene.tracks) {
    for (const s of tr.states) {
      rows.push([tr.id, tr.class, s.t, ...s.position, ...s.velocity, s.observed ? 1 : 0, s.cameras.join(' ')].map(String))
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function objectsCsv(scene: SceneDocument): string {
  const rows = [['frame', 't', 'object_id', 'track_id', 'class', 'confidence', 'x', 'y', 'z', 'w', 'h', 'l', 'method', 'cameras']]
  for (const f of scene.frames) {
    for (const o of f.objects) {
      rows.push(
        [f.index, f.t, o.id, o.trackId ?? '', o.class, o.confidence, ...o.center, ...o.size, o.method, o.visibleCameras.join(' ')].map(String),
      )
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function camerasJson(scene: SceneDocument): string {
  return JSON.stringify(
    {
      units: scene.units,
      convention: 'x_cam = R * x_world + t (OpenCV camera axes; world is +Y up)',
      cameras: scene.cameras.map((c) => ({
        id: c.id,
        label: c.label,
        width: c.width,
        height: c.height,
        intrinsics: c.intrinsics,
        calibration: c.calibration,
        pose: c.pose,
      })),
    },
    null,
    2,
  )
}

export function sceneGraphJson(scene: SceneDocument, frameIndex: number): string {
  const frame = scene.frames.find((f) => f.index === frameIndex) ?? scene.frames.at(-1)
  return JSON.stringify(
    {
      viewpoint: scene.relationsViewpoint,
      nodes: [
        ...(frame?.objects ?? []).map((o) => ({ id: o.id, class: o.class, center: o.center })),
        ...scene.regions.map((r) => ({ id: r.id, class: 'region', name: r.name })),
      ],
      edges: scene.relations,
    },
    null,
    2,
  )
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'scene'
}
