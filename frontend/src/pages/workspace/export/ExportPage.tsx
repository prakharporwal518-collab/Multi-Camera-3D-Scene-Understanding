import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { ErrorNotice } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import uiStyles from '@/components/ui/ui.module.css'
import { useWorkspace } from '@/context/WorkspaceContext'
import { usePointCloud } from '@/hooks/usePointCloud'
import type { SceneDocument } from '@/types/scene'
import { buildPly, camerasJson, downloadBlob, objectsCsv, safeFilename, sceneGraphJson, tracksCsv } from '@/utils/export'
import { fmtInt } from '@/utils/format'
import s from '../page.module.css'
import { Note, PageHeader, SceneGate } from '../shared'

export default function ExportPage() {
  return <SceneGate what="results to export">{(scene) => <Export scene={scene} />}</SceneGate>
}

interface ExportItem {
  id: string
  label: string
  format: string
  detail: string
  available: boolean
  make: () => Blob
  filename: string
}

function Export({ scene }: { scene: SceneDocument }) {
  const { source, project, isDemo } = useWorkspace()
  const toast = useToast()
  const cloud = usePointCloud(source, scene)
  const [error, setError] = useState<unknown>(null)
  const base = safeFilename(isDemo ? 'mc3d_demo' : (project.state.data?.name ?? 'scene'))
  const cloudData = cloud.status === 'ready' ? cloud.data : null
  const cloudReady = cloudData !== null
  const json = (text: string) => new Blob([text], { type: 'application/json' })
  const csv = (text: string) => new Blob([text], { type: 'text/csv' })
  const lastFrame = scene.frames.at(-1)

  const items: ExportItem[] = [
    {
      id: 'ply-all',
      label: 'Point cloud (sparse + dense)',
      format: 'PLY, binary',
      detail: `${fmtInt(scene.pointCloud.count)} points with RGB`,
      available: cloudReady,
      make: () => buildPly(cloudData!, 'all'),
      filename: `${base}_points.ply`,
    },
    {
      id: 'ply-sparse',
      label: 'Sparse SfM points',
      format: 'PLY, binary',
      detail: `${fmtInt(scene.pointCloud.sparseCount)} bundle-adjusted points`,
      available: cloudReady,
      make: () => buildPly(cloudData!, 'sparse'),
      filename: `${base}_sparse.ply`,
    },
    {
      id: 'cameras',
      label: 'Camera calibration and poses',
      format: 'JSON',
      detail: `${scene.cameras.length} cameras, K, distortion, R|t`,
      available: true,
      make: () => json(camerasJson(scene)),
      filename: `${base}_cameras.json`,
    },
    {
      id: 'objects',
      label: '3D objects per timestep',
      format: 'CSV',
      detail: `${scene.frames.reduce((n, f) => n + f.objects.length, 0)} rows`,
      available: scene.frames.length > 0,
      make: () => csv(objectsCsv(scene)),
      filename: `${base}_objects.csv`,
    },
    {
      id: 'tracks',
      label: 'Object tracks',
      format: 'CSV',
      detail: `${scene.tracks.length} tracks, one row per state`,
      available: scene.tracks.length > 0,
      make: () => csv(tracksCsv(scene)),
      filename: `${base}_tracks.csv`,
    },
    {
      id: 'graph',
      label: 'Scene graph',
      format: 'JSON',
      detail: `${scene.relations.length} relations`,
      available: scene.relations.length > 0,
      make: () => json(sceneGraphJson(scene, lastFrame?.index ?? 0)),
      filename: `${base}_scene_graph.json`,
    },
    {
      id: 'scene',
      label: 'Complete scene document',
      format: 'JSON',
      detail: 'Everything above except the binary point cloud',
      available: true,
      make: () => json(JSON.stringify(scene, null, 1)),
      filename: `${base}_scene.json`,
    },
  ]

  const run = (item: ExportItem) => {
    setError(null)
    try {
      downloadBlob(item.make(), item.filename)
      toast.show('ok', `${item.filename} downloaded`)
    } catch (err) {
      setError(err)
    }
  }

  return (
    <div className={s.page}>
      <PageHeader title="Export" description="Download results in standard formats. Files are generated in the browser from the loaded scene." />
      {scene.source === 'demo' && (
        <Note tone="sample">Exports of the demo contain synthetic data and simulated detections; the scene document records this in its provenance field.</Note>
      )}
      {cloud.status === 'error' && <ErrorNotice error={cloud.error} title="Point cloud unavailable for export" onRetry={cloud.retry} />}
      {error !== null && <ErrorNotice error={error} title="Export failed" />}
      <Panel flush>
        <div className={uiStyles.tableScroll}>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th>Content</th>
                <th>Format</th>
                <th>Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td className="mono">{item.format}</td>
                  <td className="muted">{item.detail}</td>
                  <td className={uiStyles.right}>
                    <Button
                      size="sm"
                      icon="export"
                      disabled={!item.available}
                      loading={item.id.startsWith('ply') && cloud.status === 'loading'}
                      title={item.available ? undefined : 'Not available for this reconstruction'}
                      onClick={() => run(item)}
                    >
                      Download
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
        Coordinates use a right-handed, +Y-up world frame {scene.units === 'm' ? 'in metres' : 'in relative units (initial baseline = 1)'}. Camera poses
        follow the OpenCV convention x_cam = R·x_world + t. PLY files open in MeshLab, CloudCompare and Open3D.
      </p>
    </div>
  )
}
