/// <reference lib="webworker" />
import { backproject, decodeDepthRgba } from '@/services/depthCodec'
import type { DepthWorkerRequest, DepthWorkerResponse } from './depthProtocol'

async function loadPixels(url: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('/').pop()}`)
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable in worker')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return ctx.getImageData(0, 0, width, height).data
}

self.onmessage = async (event: MessageEvent<DepthWorkerRequest>) => {
  const req = event.data
  try {
    const raw = await loadPixels(req.depthUrl, req.width, req.height)
    const decoded = decodeDepthRgba(raw, req.width, req.height, req.step)
    let rgb: Uint8ClampedArray | null = null
    if (req.rgbUrl) {
      try {
        rgb = await loadPixels(req.rgbUrl, req.width, req.height)
      } catch {
        rgb = null // colours are optional; the geometry is still useful
      }
    }
    const cloud = req.pose ? backproject(decoded, req.intrinsics, req.pose, rgb, 1) : null
    const msg: DepthWorkerResponse = { id: req.id, ok: true, decoded, cloud }
    const transfer: Transferable[] = [decoded.depth.buffer, decoded.confidence.buffer]
    if (cloud) transfer.push(cloud.positions.buffer, cloud.colors.buffer)
    self.postMessage(msg, transfer)
  } catch (err) {
    const msg: DepthWorkerResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  }
}
