import type { Relation, SceneDocument, SceneObject } from '@/types/scene'

export interface GraphNode {
  id: string
  kind: 'object' | 'region' | 'ground'
  label: string
  cls: string
  x: number
  y: number
  r: number
  object?: SceneObject
}

export interface GraphEdge {
  relation: Relation
  source: GraphNode
  target: GraphNode
}

/**
 * Nodes are placed at their plan-view (X–Z) position so the graph keeps the scene's spatial
 * arrangement, then pushed apart where they overlap. Regions sit at their centroid and the
 * ground plane below everything.
 */
export function layoutGraph(scene: SceneDocument, objects: SceneObject[], width: number, height: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const referenced = new Set(scene.relations.flatMap((r) => [r.subject, r.object]))
  const raw: Omit<GraphNode, 'x' | 'y'>[] = []
  const pos: [number, number][] = []
  for (const o of objects) {
    raw.push({ id: o.id, kind: 'object', label: o.trackId !== null ? `#${o.trackId}` : o.id, cls: o.class, r: 20, object: o })
    pos.push([o.center[0], o.center[2]])
  }
  for (const reg of scene.regions) {
    if (!referenced.has(reg.id)) continue
    const cx = reg.polygon.reduce((a, p) => a + p[0], 0) / reg.polygon.length
    const cz = reg.polygon.reduce((a, p) => a + p[1], 0) / reg.polygon.length
    raw.push({ id: reg.id, kind: 'region', label: reg.name, cls: 'region', r: 26 })
    pos.push([cx, cz])
  }
  if (pos.length === 0) return { nodes: [], edges: [] }

  const xs = pos.map((p) => p[0])
  const zs = pos.map((p) => p[1])
  const pad = 60
  const spanX = Math.max(...xs) - Math.min(...xs) || 1
  const spanZ = Math.max(...zs) - Math.min(...zs) || 1
  const k = Math.min((width - 2 * pad) / spanX, (height - 2 * pad - 60) / spanZ)
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2
  const cz = (Math.max(...zs) + Math.min(...zs)) / 2
  const nodes: GraphNode[] = raw.map((n, i) => ({
    ...n,
    // X increases to the left in plan views that look along +Z, matching the camera images.
    x: width / 2 - (pos[i][0] - cx) * k,
    y: (height - 60) / 2 - (pos[i][1] - cz) * k,
  }))
  if (referenced.has('ground')) {
    nodes.push({ id: 'ground', kind: 'ground', label: 'Ground plane', cls: 'ground', x: width / 2, y: height - 28, r: 22 })
  }
  relax(nodes, width, height)

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: GraphEdge[] = []
  for (const rel of scene.relations) {
    const source = byId.get(rel.subject)
    const target = byId.get(rel.object)
    if (source && target) edges.push({ relation: rel, source, target })
  }
  return { nodes, edges }
}

function relax(nodes: GraphNode[], width: number, height: number) {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const min = a.r + b.r + 26
        if (d < min) {
          const push = (min - d) / 2
          const ux = dx / d
          const uy = dy / d
          if (a.kind !== 'ground') {
            a.x -= ux * push
            a.y -= uy * push
          }
          if (b.kind !== 'ground') {
            b.x += ux * push
            b.y += uy * push
          }
          moved = true
        }
      }
    }
    for (const n of nodes) {
      n.x = Math.min(width - n.r - 4, Math.max(n.r + 4, n.x))
      n.y = Math.min(height - n.r - 4, Math.max(n.r + 4, n.y))
    }
    if (!moved) break
  }
}
