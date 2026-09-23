import { useMemo, useState } from 'react'
import { DataSourceBadge } from '@/components/DataSourceBadge'
import { Checkbox } from '@/components/ui/Form'
import { KeyValue } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/States'
import uiStyles from '@/components/ui/ui.module.css'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { Relation, SceneDocument } from '@/types/scene'
import { capitalise, fmtNumber, fmtPercent } from '@/utils/format'
import { classColor } from '@/utils/palette'
import s from '../page.module.css'
import { Note, PageHeader, SceneGate } from '../shared'
import { layoutGraph, type GraphNode } from './layout'

const W = 720
const H = 460
const PREDICATES = ['near', 'on', 'inside', 'behind'] as const
const PREDICATE_HELP: Record<string, string> = {
  near: 'Footprints closer than the near-distance threshold',
  on: 'Resting on a surface region or on the ground plane',
  inside: 'Centre lies inside a region polygon',
  behind: 'Farther from the viewpoint camera with overlapping bearing',
}

export default function SceneGraphPage() {
  return <SceneGate what="scene graph">{(scene) => <SceneGraph scene={scene} />}</SceneGate>
}

/** Width of a region/ground node: wide enough for its monospace label. */
function boxWidth(n: GraphNode): number {
  return Math.max(n.r * 3.6, n.label.length * 7 + 20)
}

function describe(rel: Relation, name: (id: string) => string): string {
  const v = rel.value !== undefined ? ` (${fmtNumber(rel.value, 2)} ${rel.unit ?? ''})` : ''
  return `${name(rel.subject)} → ${rel.predicate} → ${name(rel.object)}${v}`
}

function SceneGraph({ scene }: { scene: SceneDocument }) {
  const { selection, select } = useWorkspace()
  // Relations are computed for the last timestep.
  const frame = scene.frames.at(-1)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ near: true, on: true, inside: true, behind: true })
  const [selectedNode, setSelectedNode] = useState<string | null>(selection.objectId)
  const graph = useMemo(() => layoutGraph(scene, frame?.objects ?? [], W, H), [scene, frame])
  const nameOf = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    if (!n) return id
    return n.kind === 'object' ? `${capitalise(n.cls)} ${n.label}` : n.label
  }

  if (scene.relations.length === 0 || !frame) {
    const stage = scene.stats.stages.find((st) => st.id === 'scene_understanding')
    return (
      <div className={s.page}>
        <PageHeader title="Scene Graph" />
        <Panel>
          <EmptyState icon="graph" title="No scene graph for this reconstruction">
            {stage?.message ?? 'Relations are derived from detected objects, and none are available.'}
          </EmptyState>
        </Panel>
      </div>
    )
  }

  const edges = graph.edges.filter((e) => enabled[e.relation.predicate] ?? true)
  const node = graph.nodes.find((n) => n.id === selectedNode) ?? null
  const nodeRelations = node ? scene.relations.filter((r) => r.subject === node.id || r.object === node.id) : []
  const choose = (n: GraphNode) => {
    setSelectedNode(n.id)
    if (n.object) select({ objectId: n.id, trackId: n.object.trackId })
  }

  return (
    <div className={s.page}>
      <PageHeader
        title="Scene Graph"
        description={`Spatial relations between objects at t = ${fmtNumber(frame.t, 1)} s. Each edge records the measurement that produced it.`}
        actions={<DataSourceBadge scene={scene} layer="sceneGraph" />}
      />
      <Note>
        Relations are rule-based on 3D geometry (distances, region polygons, bearings from {scene.relationsViewpoint ?? 'the reference camera'}), not
        predicted by a learned model. Nodes are placed at their plan-view position.
        {scene.provenance.detections === 'simulated' && ' The underlying detections of the demo are simulated.'}
      </Note>

      <div className={s.split}>
        <Panel
          title="Graph"
          subtitle={`${graph.nodes.length} nodes · ${edges.length} edges shown`}
          actions={
            <div className={s.toolbar}>
              {PREDICATES.map((p) => (
                <span key={p} title={PREDICATE_HELP[p]}>
                  <Checkbox label={p} checked={enabled[p]} onChange={(v) => setEnabled((e) => ({ ...e, [p]: v }))} />
                </span>
              ))}
            </div>
          }
        >
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Scene graph">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 10 5 0 10z" fill="#7c848e" />
              </marker>
              <marker id="arrow-hl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 10 5 0 10z" fill="#6aa5f0" />
              </marker>
            </defs>
            <rect width={W} height={H} fill="#111315" />
            {edges.map((e, i) => {
              const hl = node && (e.source.id === node.id || e.target.id === node.id)
              const dx = e.target.x - e.source.x
              const dy = e.target.y - e.source.y
              const d = Math.hypot(dx, dy) || 1
              const x1 = e.source.x + (dx / d) * e.source.r
              const y1 = e.source.y + (dy / d) * e.source.r
              const x2 = e.target.x - (dx / d) * (e.target.r + 3)
              const y2 = e.target.y - (dy / d) * (e.target.r + 3)
              // bend so that A→B and B→A edges do not overlap
              const bend = 0.15 * d
              const mx = (x1 + x2) / 2 - (dy / d) * bend
              const my = (y1 + y2) / 2 + (dx / d) * bend
              return (
                <g key={i} opacity={node && !hl ? 0.25 : 1}>
                  <path
                    d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
                    fill="none"
                    stroke={hl ? '#6aa5f0' : '#565e68'}
                    strokeWidth={hl ? 1.8 : 1.2}
                    strokeDasharray={e.relation.predicate === 'behind' ? '4 3' : undefined}
                    markerEnd={`url(#${hl ? 'arrow-hl' : 'arrow'})`}
                  />
                  <text x={mx} y={my} fill={hl ? '#e3e6ea' : '#aab1ba'} fontSize={10.5} textAnchor="middle" paintOrder="stroke" stroke="#111315" strokeWidth={3}>
                    {e.relation.predicate}
                  </text>
                </g>
              )
            })}
            {graph.nodes.map((n) => {
              const selected = n.id === selectedNode
              const color = n.kind === 'object' ? classColor(n.cls) : n.kind === 'region' ? '#c8a45e' : '#7c848e'
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${nameOf(n.id)}; ${scene.relations.filter((r) => r.subject === n.id || r.object === n.id).length} relations`}
                  onClick={() => choose(n)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && choose(n)}
                  style={{ cursor: 'pointer' }}
                >
                  {n.kind === 'object' ? (
                    <circle r={n.r} fill="#1b1e22" stroke={selected ? '#ffffff' : color} strokeWidth={selected ? 2.5 : 1.5} />
                  ) : (
                    <rect
                      x={-boxWidth(n) / 2}
                      y={-n.r * 0.7}
                      width={boxWidth(n)}
                      height={n.r * 1.4}
                      rx={3}
                      fill="#1b1e22"
                      stroke={selected ? '#ffffff' : color}
                      strokeDasharray={n.kind === 'region' ? '4 3' : undefined}
                      strokeWidth={selected ? 2.5 : 1.2}
                    />
                  )}
                  <text textAnchor="middle" dy={n.kind === 'object' ? -2 : 4} fill="#e3e6ea" fontSize={11} fontFamily="var(--font-mono)">
                    {n.label}
                  </text>
                  {n.kind === 'object' && (
                    <text textAnchor="middle" dy={11} fill={color} fontSize={9.5}>
                      {n.cls}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </Panel>

        <div className={s.sideStack}>
          <Panel title={node ? nameOf(node.id) : 'Node'}>
            {!node ? (
              <p className="muted">Select a node to inspect its properties and relations.</p>
            ) : (
              <div className={s.controlsStack}>
                {node.object ? (
                  <KeyValue
                    items={[
                      ['Class', capitalise(node.object.class)],
                      ['Track', node.object.trackId !== null ? `#${node.object.trackId}` : '—'],
                      ['Confidence', fmtPercent(node.object.confidence)],
                      ['Centre', <span className="num">{node.object.center.map((v) => fmtNumber(v, 2)).join(', ')}</span>],
                      ['Size', <span className="num">{node.object.size.map((v) => fmtNumber(v, 2)).join(' × ')}</span>],
                      ['Cameras', node.object.visibleCameras.join(', ')],
                    ]}
                  />
                ) : (
                  <KeyValue items={[['Type', node.kind === 'region' ? 'Annotated region' : 'Fitted ground plane (y = 0)']]} />
                )}
                <div>
                  <p className="faint" style={{ marginBottom: 4 }}>
                    Relations ({nodeRelations.length})
                  </p>
                  <ul className={s.list} style={{ fontSize: 'var(--fs-sm)' }}>
                    {nodeRelations.map((r, i) => (
                      <li key={i} style={{ padding: '2px 0' }}>
                        {describe(r, nameOf)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Panel>
          <Panel title="Predicates">
            <KeyValue items={PREDICATES.map((p) => [p, <span className="muted">{PREDICATE_HELP[p]}</span>])} />
          </Panel>
        </div>
      </div>

      <Panel title="Relations" subtitle={`${scene.relations.length} total`} flush>
        <div className={uiStyles.tableScroll} style={{ maxHeight: 320 }}>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Predicate</th>
                <th>Object</th>
                <th className={uiStyles.right}>Measured</th>
              </tr>
            </thead>
            <tbody>
              {scene.relations.map((r, i) => (
                <tr key={i} data-selected={selectedNode === r.subject || selectedNode === r.object}>
                  <td>{nameOf(r.subject)}</td>
                  <td className="mono">{r.predicate}</td>
                  <td>{nameOf(r.object)}</td>
                  <td className={`${uiStyles.right} num`}>{r.value !== undefined ? `${fmtNumber(r.value, 2)} ${r.unit ?? ''}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
