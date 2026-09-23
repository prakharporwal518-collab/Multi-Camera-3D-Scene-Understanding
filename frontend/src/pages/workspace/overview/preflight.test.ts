import { describe, expect, it } from 'vitest'
import type { Camera } from '@/types/project'
import { preflight } from './preflight'

const cam = (label: string, frameCount: number) => ({ label, frameCount }) as Camera

describe('preflight', () => {
  it('needs two cameras', () => {
    expect(preflight([])).toMatch(/at least two cameras/)
    expect(preflight([cam('CAM-01', 5)])).toMatch(/at least two cameras/)
  })

  it('names the cameras that still need frames', () => {
    expect(preflight([cam('CAM-01', 5), cam('CAM-02', 0), cam('CAM-03', 0)])).toBe(
      'At least two cameras need frames. Without frames: CAM-02, CAM-03.',
    )
  })

  it('passes when two cameras have frames', () => {
    expect(preflight([cam('CAM-01', 5), cam('CAM-02', 3), cam('CAM-03', 0)])).toBeNull()
  })
})
