import type { DepthWorkerRequest, DepthWorkerResponse } from '@/workers/depthProtocol'
import { backproject, decodeDepthRgba, type BackprojectedCloud, type DecodedDepth } from './depthCodec'

export interface DepthLoadResult {
  decoded: DecodedDepth
  cloud: BackprojectedCloud | null
}

type Pending = { resolve: (r: DepthLoadResult) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/depth.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<DepthWorkerResponse>) => {
      const msg = e.data
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve({ decoded: msg.decoded, cloud: msg.cloud })
      else p.reject(new Error(msg.error))
    }
    worker.onerror = () => {
      // A worker that fails to start (e.g. blocked by CSP) should not break the page.
      workerBroken = true
      worker?.terminate()
      worker = null
      pending.forEach((p) => p.reject(new Error('Depth worker failed to start')))
      pending.clear()
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

async function loadPixelsMainThread(url: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

async function loadOnMainThread(req: Omit<DepthWorkerRequest, 'id'>): Promise<DepthLoadResult> {
  const raw = await loadPixelsMainThread(req.depthUrl, req.width, req.height)
  const decoded = decodeDepthRgba(raw, req.width, req.height, req.step)
  const rgb = req.rgbUrl ? await loadPixelsMainThread(req.rgbUrl, req.width, req.height).catch(() => null) : null
  const cloud = req.pose ? backproject(decoded, req.intrinsics, req.pose, rgb, 2) : null
  return { decoded, cloud }
}

/** Decode a depth map (and back-project it) in a worker, falling back to the main thread. */
export function loadDepthMap(req: Omit<DepthWorkerRequest, 'id'>): Promise<DepthLoadResult> {
  const w = getWorker()
  if (!w) return loadOnMainThread(req)
  const id = nextId++
  return new Promise<DepthLoadResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ ...req, id } satisfies DepthWorkerRequest)
  }).catch(() => loadOnMainThread(req))
}
