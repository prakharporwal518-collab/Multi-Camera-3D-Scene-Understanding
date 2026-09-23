import { describe, expect, it } from 'vitest'
import { parseNumber, validateImageFiles, validateName, validateVideoFile } from './validation'

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name)

describe('validateImageFiles', () => {
  it('accepts supported images and explains every rejection', () => {
    const { accepted, rejected } = validateImageFiles(
      [file('a.JPG'), file('b.png'), file('notes.txt'), file('empty.png', 0), file('huge.jpg', 30 * 1024 * 1024), file('noext')],
      0,
    )
    expect(accepted.map((f) => f.name)).toEqual(['a.JPG', 'b.png'])
    expect(rejected).toEqual([
      { file: 'notes.txt', reason: '.txt files are not supported images' },
      { file: 'empty.png', reason: 'file is empty' },
      { file: 'huge.jpg', reason: 'larger than 25 MB' },
      { file: 'noext', reason: 'file has no extension' },
    ])
  })

  it('stops at the per-camera frame limit', () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`${i}.png`))
    const { accepted, rejected } = validateImageFiles(files, 298, { maxImageMb: 25, maxVideoMb: 250, maxFramesPerCamera: 300 })
    expect(accepted).toHaveLength(2)
    expect(rejected).toHaveLength(3)
    expect(rejected[0].reason).toContain('frame limit')
  })

  it('handles an empty selection', () => {
    expect(validateImageFiles([], 0)).toEqual({ accepted: [], rejected: [] })
  })
})

describe('validateVideoFile', () => {
  it('requires a supported, non-empty file within the size limit', () => {
    expect(validateVideoFile(undefined)).toBe('Choose a video file.')
    expect(validateVideoFile(file('clip.gif'))).toContain('not a supported video format')
    expect(validateVideoFile(file('clip.mp4', 0))).toBe('The video file is empty.')
    expect(validateVideoFile(file('clip.mov'))).toBeNull()
  })
})

describe('parseNumber', () => {
  const rule = { label: 'Frame stride', min: 1, max: 100, integer: true, required: true }
  it.each([
    ['', 'Frame stride is required.'],
    ['abc', 'Frame stride must be a number.'],
    ['2.5', 'Frame stride must be a whole number.'],
    ['0', 'Frame stride must be at least 1.'],
    ['101', 'Frame stride must be at most 100.'],
    ['Infinity', 'Frame stride must be a number.'],
  ])('rejects %j', (raw, message) => {
    expect(parseNumber(raw, rule)).toEqual({ value: null, error: message })
  })

  it('accepts valid values and optional blanks', () => {
    expect(parseNumber(' 12 ', rule)).toEqual({ value: 12, error: null })
    expect(parseNumber('', { label: 'Baseline' })).toEqual({ value: null, error: null })
    expect(parseNumber('0', { label: 'Baseline', min: 0, exclusiveMin: true }).error).toBe('Baseline must be greater than 0.')
  })
})

describe('validateName', () => {
  it('requires visible text without control characters', () => {
    expect(validateName('   ')).toBe('Name is required.')
    expect(validateName('x'.repeat(121))).toContain('at most 120')
    expect(validateName('bad\u0007')).toContain('invalid characters')
    expect(validateName('North lot')).toBeNull()
  })
})
