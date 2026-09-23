import { ApiError } from './apiClient'

/** Parsed `points.bin`: xyz float32, rgb uint8, layer uint8 (0 = sparse, 1 = dense). */
export interface PointCloudData {
  count: number
  positions: Float32Array
  colors: Uint8Array
  layers: Uint8Array
}

const BYTES_PER_POINT = 16

export function parsePointCloud(buffer: ArrayBuffer, expectedCount?: number): PointCloudData {
  if (buffer.byteLength % BYTES_PER_POINT !== 0) {
    throw new ApiError('parse', 'The point cloud file is truncated or corrupted.', {
      hint: `Size ${buffer.byteLength} bytes is not a multiple of ${BYTES_PER_POINT}.`,
    })
  }
  const count = buffer.byteLength / BYTES_PER_POINT
  if (expectedCount !== undefined && expectedCount !== count) {
    throw new ApiError('parse', `The point cloud has ${count} points but the scene lists ${expectedCount}.`, {
      hint: 'The scene and its point file are out of sync. Re-run the pipeline.',
    })
  }
  return {
    count,
    positions: new Float32Array(buffer, 0, count * 3),
    colors: new Uint8Array(buffer, count * 12, count * 3),
    layers: new Uint8Array(buffer, count * 15, count),
  }
}

/** Download with progress. Falls back to a plain arrayBuffer() when streaming is unavailable. */
export async function fetchBinary(
  url: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch {
    if (signal?.aborted) throw new ApiError('aborted', 'The download was cancelled.')
    throw new ApiError('network', 'The point cloud could not be downloaded.')
  }
  if (!res.ok) {
    throw new ApiError('http', `The point cloud file could not be loaded (HTTP ${res.status}).`, { status: res.status })
  }
  const total = Number(res.headers.get('Content-Length')) || 0
  if (!res.body || !total || !onProgress) return res.arrayBuffer()
  const reader = res.body.getReader()
  const out = new Uint8Array(total)
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (received + value.length > total) return concatFallback(out.subarray(0, received), value, reader)
    out.set(value, received)
    received += value.length
    onProgress(received / total)
  }
  return out.buffer.slice(0, received)
}

// Content-Length can be wrong when a proxy compresses the response; collect the rest safely.
async function concatFallback(
  head: Uint8Array,
  next: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ArrayBuffer> {
  const chunks = [head.slice(), next]
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const size = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out.buffer
}
