import { describe, expect, it } from 'vitest'
import { backproject, colorize, decodeDepthRgba } from './depthCodec'
import { parsePointCloud } from './pointCloud'
import { expandFrameUrl, precomputedToMatchData } from './sceneSource'

function cloudBuffer(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(n * 16)
  const pos = new Float32Array(buf, 0, n * 3)
  const col = new Uint8Array(buf, n * 12, n * 3)
  const layer = new Uint8Array(buf, n * 15, n)
  for (let i = 0; i < n; i++) {
    pos.set([i, i * 2, i * 3], i * 3)
    col.set([10, 20, 30], i * 3)
    layer[i] = i % 2
  }
  return buf
}

describe('parsePointCloud', () => {
  it('views the buffer without copying', () => {
    const data = parsePointCloud(cloudBuffer(4), 4)
    expect(data.count).toBe(4)
    expect(Array.from(data.positions.slice(3, 6))).toEqual([1, 2, 3])
    expect(Array.from(data.layers)).toEqual([0, 1, 0, 1])
  })

  it('rejects truncated files and count mismatches', () => {
    expect(() => parsePointCloud(new ArrayBuffer(33))).toThrow(/truncated/)
    expect(() => parsePointCloud(cloudBuffer(3), 4)).toThrow(/3 points but the scene lists 4/)
  })
})

describe('depth codec', () => {
  it('decodes 16-bit depth and confidence; zero means no estimate', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 1, 44, 128, 255])
    const d = decodeDepthRgba(rgba, 2, 1, 0.01)
    expect(d.depth[0]).toBe(0)
    expect(d.depth[1]).toBeCloseTo(3.0, 6) // (1 * 256 + 44) * 0.01
    expect(d.confidence[1]).toBeCloseTo(128 / 255)
  })

  it('makes pixels without data transparent when colouring', () => {
    const values = new Float32Array([0, 5, 10])
    const out = new Uint8ClampedArray(12)
    colorize(values, values, 5, 10, out)
    expect(out[3]).toBe(0)
    expect(out[7]).toBe(255)
    expect(out[11]).toBe(255)
  })

  it('back-projects with an identity pose', () => {
    const d = { width: 2, height: 1, depth: new Float32Array([2, 0]), confidence: new Float32Array([1, 0]) }
    const intr = { fx: 1, fy: 1, cx: 0, cy: 0, width: 2, height: 1, dist: [] }
    const pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] as [number, number, number], position: [0, 0, 0] as [number, number, number] }
    const cloud = backproject(d, intr, pose, null)
    expect(cloud.count).toBe(1)
    expect(Array.from(cloud.positions)).toEqual([0, 0, 2])
  })
})

describe('scene source helpers', () => {
  it('expands frame URL templates', () => {
    expect(expandFrameUrl('frames/cam01/{index:03d}.jpg', 7)).toBe('frames/cam01/007.jpg')
    expect(expandFrameUrl('cameras/x/frames/{index}/image', 12)).toBe('cameras/x/frames/12/image')
  })

  it('filters precomputed matches by ratio and swaps camera order', () => {
    const file = {
      cameraA: 'a',
      cameraB: 'b',
      detector: 'sift' as const,
      featuresA: 100,
      featuresB: 90,
      detectMsA: 1,
      detectMsB: 2,
      matchMs: 3,
      matches: [
        [1, 1, 2, 2, 0.5],
        [3, 3, 4, 4, 0.72],
        [5, 5, 6, 6, 0.85],
      ] as [number, number, number, number, number][],
      inliersByRatio: { '0.75': [0] },
    }
    const straight = precomputedToMatchData(file, 0.75, false)
    expect(straight.matches).toEqual([
      [1, 1, 2, 2, true],
      [3, 3, 4, 4, false],
    ])
    const swapped = precomputedToMatchData(file, 0.75, true)
    expect(swapped.cameraA).toBe('b')
    expect(swapped.featuresA).toBe(90)
    expect(swapped.matches[0]).toEqual([2, 2, 1, 1, true])
  })
})
