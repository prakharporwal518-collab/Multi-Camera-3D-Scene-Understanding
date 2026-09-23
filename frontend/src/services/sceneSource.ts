import type { FeatureDetector } from '@/types/project'
import type { PrecomputedMatchIndex, SceneCamera, SceneDocument } from '@/types/scene'
import { api } from './api'
import { ApiError, apiUrl } from './apiClient'
import { DEMO_BASE } from './env'

export const DEMO_PROJECT_ID = 'demo'

/** Matches between two cameras in a form shared by precomputed (demo) and live (API) results. */
export interface MatchData {
  cameraA: string
  cameraB: string
  detector: FeatureDetector
  ratio: number
  featuresA: number
  featuresB: number
  /** [xa, ya, xb, yb, inlier] in native pixel coordinates */
  matches: [number, number, number, number, boolean][]
  tentative: number
  inliers: number
  timings: { detectA: number; detectB: number; match: number }
  origin: 'precomputed' | 'live'
}

export interface SceneSource {
  kind: 'demo' | 'api'
  projectId: string
  loadScene(signal?: AbortSignal): Promise<SceneDocument>
  /** URL of a result file referenced by the scene (points.bin, depth maps). */
  resultUrl(relative: string): string
  frameUrl(camera: SceneCamera, index: number): string
  loadMatches(
    scene: SceneDocument | null,
    a: string,
    b: string,
    detector: FeatureDetector,
    ratio: number,
    signal?: AbortSignal,
  ): Promise<MatchData>
  /** Parameter values the source can serve; `null` means any value in range. */
  matchRatios: number[] | null
}

export function expandFrameUrl(template: string, index: number): string {
  return template.replace(/\{index(?::0(\d)d)?\}/, (_m, width?: string) =>
    width ? String(index).padStart(Number(width), '0') : String(index),
  )
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (err) {
    if (signal?.aborted) throw new ApiError('aborted', 'The request was cancelled.')
    throw new ApiError('network', 'Demo data could not be downloaded.', { hint: String(err) })
  }
  // SPA hosts answer unknown paths with index.html, so a missing file can arrive as HTML with status 200.
  if (!res.ok || res.headers.get('Content-Type')?.includes('text/html')) {
    throw new ApiError('http', `Demo file ${url.split('/').pop()} is missing from this deployment.`, {
      status: res.status,
      hint: 'Rebuild the demo dataset with `python -m scripts.build_demo` in backend/ and redeploy the frontend.',
    })
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('parse', `Demo file ${url.split('/').pop()} is not valid JSON.`)
  }
}

interface PrecomputedMatchFile {
  cameraA: string
  cameraB: string
  detector: FeatureDetector
  featuresA: number
  featuresB: number
  detectMsA: number
  detectMsB: number
  matchMs: number
  matches: [number, number, number, number, number][]
  inliersByRatio: Record<string, number[]>
}

const DEMO_RATIOS = [0.6, 0.7, 0.75, 0.8, 0.9]

export function precomputedToMatchData(file: PrecomputedMatchFile, ratio: number, swapped: boolean): MatchData {
  const inlierSet = new Set(file.inliersByRatio[String(ratio)] ?? [])
  const rows: MatchData['matches'] = []
  file.matches.forEach((m, i) => {
    if (m[4] >= ratio) return
    const inlier = inlierSet.has(i)
    rows.push(swapped ? [m[2], m[3], m[0], m[1], inlier] : [m[0], m[1], m[2], m[3], inlier])
  })
  return {
    cameraA: swapped ? file.cameraB : file.cameraA,
    cameraB: swapped ? file.cameraA : file.cameraB,
    detector: file.detector,
    ratio,
    featuresA: swapped ? file.featuresB : file.featuresA,
    featuresB: swapped ? file.featuresA : file.featuresB,
    matches: rows,
    tentative: rows.length,
    inliers: inlierSet.size,
    timings: {
      detectA: swapped ? file.detectMsB : file.detectMsA,
      detectB: swapped ? file.detectMsA : file.detectMsB,
      match: file.matchMs,
    },
    origin: 'precomputed',
  }
}

export const demoSource: SceneSource = {
  kind: 'demo',
  projectId: DEMO_PROJECT_ID,
  matchRatios: DEMO_RATIOS,
  loadScene: (signal) => fetchJson<SceneDocument>(`${DEMO_BASE}scene.json`, signal),
  resultUrl: (relative) => `${DEMO_BASE}${relative}`,
  frameUrl: (camera, index) => `${DEMO_BASE}${expandFrameUrl(camera.frameUrl, index)}`,
  async loadMatches(scene, a, b, detector, ratio, signal) {
    const list: PrecomputedMatchIndex[] = scene?.matching.precomputed ?? []
    const entry = list.find(
      (m) => m.detector === detector && ((m.a === a && m.b === b) || (m.a === b && m.b === a)),
    )
    if (!entry) {
      throw new ApiError('http', `No precomputed matches for this camera pair with ${detector.toUpperCase()}.`, {
        code: 'not_precomputed',
      })
    }
    const file = await fetchJson<PrecomputedMatchFile>(`${DEMO_BASE}${entry.file}`, signal)
    return precomputedToMatchData(file, ratio, entry.a !== a)
  },
}

export function apiSource(projectId: string): SceneSource {
  return {
    kind: 'api',
    projectId,
    matchRatios: null,
    loadScene: (signal) => api.scene(projectId, signal),
    resultUrl: (relative) => apiUrl(`/scene/${encodeURIComponent(projectId)}/files/${encodeURIComponent(relative)}`),
    frameUrl: (camera, index) => apiUrl(`/${expandFrameUrl(camera.frameUrl, index)}`),
    async loadMatches(_scene, a, b, detector, ratio, signal) {
      const res = await api.matchFeatures(projectId, { cameraA: a, cameraB: b, detector, ratio }, signal)
      return {
        cameraA: res.cameraA,
        cameraB: res.cameraB,
        detector: res.detector,
        ratio: res.ratio,
        featuresA: res.featuresA,
        featuresB: res.featuresB,
        matches: res.matches.map((m) => [m[0], m[1], m[2], m[3], m[5]]),
        tentative: res.tentative,
        inliers: res.inliers,
        timings: { detectA: res.detectMsA, detectB: res.detectMsB, match: res.matchMs },
        origin: 'live',
      }
    },
  }
}

export function sourceFor(projectId: string): SceneSource {
  return projectId === DEMO_PROJECT_ID ? demoSource : apiSource(projectId)
}
