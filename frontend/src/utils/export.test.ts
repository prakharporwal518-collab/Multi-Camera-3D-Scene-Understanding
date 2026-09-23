import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '@/types/scene'
import { buildPly, safeFilename, tracksCsv } from './export'

describe('buildPly', () => {
  it('writes a binary PLY with the selected layer only', async () => {
    const cloud = {
      count: 3,
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      colors: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]),
      layers: new Uint8Array([0, 1, 1]),
    }
    const blob = buildPly(cloud, 'dense')
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
    expect(text.startsWith('ply\nformat binary_little_endian 1.0')).toBe(true)
    expect(text).toContain('element vertex 2\n')
    const headerLength = text.indexOf('end_header\n') + 'end_header\n'.length
    expect(blob.size - headerLength).toBe(2 * 15)
  })
})

describe('tracksCsv', () => {
  it('writes one row per state and quotes fields that need it', () => {
    const scene = {
      tracks: [
        {
          id: 3,
          class: 'car, parked',
          states: [{ t: 0, position: [1, 0, 2], velocity: [0, 0, 0], observed: true, cameras: ['CAM-01', 'CAM-02'] }],
        },
      ],
    } as unknown as SceneDocument
    const lines = tracksCsv(scene).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('3,"car, parked",0,1,0,2,0,0,0,1,CAM-01 CAM-02')
  })
})

describe('safeFilename', () => {
  it('keeps names portable', () => {
    expect(safeFilename('Parking lot / north')).toBe('Parking_lot_north')
    expect(safeFilename('***')).toBe('scene')
  })
})
