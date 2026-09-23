/**
 * Client-side checks that mirror the backend limits so obviously invalid input is
 * rejected before it is uploaded. The backend validates again; these are for fast feedback.
 */

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tif', 'tiff'] as const
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'] as const

export interface UploadLimits {
  maxImageMb: number
  maxVideoMb: number
  maxFramesPerCamera: number
}

export const DEFAULT_LIMITS: UploadLimits = { maxImageMb: 25, maxVideoMb: 250, maxFramesPerCamera: 300 }
export const MAX_FILES_PER_REQUEST = 60

export interface FileIssue {
  file: string
  reason: string
}

export interface FileCheck {
  accepted: File[]
  rejected: FileIssue[]
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function validateImageFiles(files: File[], existingFrames: number, limits: UploadLimits = DEFAULT_LIMITS): FileCheck {
  const accepted: File[] = []
  const rejected: FileIssue[] = []
  const maxBytes = limits.maxImageMb * 1024 * 1024
  for (const file of files) {
    const ext = extensionOf(file.name)
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      rejected.push({ file: file.name, reason: ext ? `.${ext} files are not supported images` : 'file has no extension' })
    } else if (file.size === 0) {
      rejected.push({ file: file.name, reason: 'file is empty' })
    } else if (file.size > maxBytes) {
      rejected.push({ file: file.name, reason: `larger than ${limits.maxImageMb} MB` })
    } else {
      accepted.push(file)
    }
  }
  const room = Math.max(0, limits.maxFramesPerCamera - existingFrames)
  if (accepted.length > room) {
    for (const file of accepted.splice(room)) {
      rejected.push({ file: file.name, reason: `camera frame limit (${limits.maxFramesPerCamera}) reached` })
    }
  }
  return { accepted, rejected }
}

export function validateVideoFile(file: File | undefined, limits: UploadLimits = DEFAULT_LIMITS): string | null {
  if (!file) return 'Choose a video file.'
  const ext = extensionOf(file.name)
  if (!(VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    return `.${ext || '?'} is not a supported video format (use ${VIDEO_EXTENSIONS.join(', ')}).`
  }
  if (file.size === 0) return 'The video file is empty.'
  if (file.size > limits.maxVideoMb * 1024 * 1024) return `The video is larger than the ${limits.maxVideoMb} MB limit.`
  return null
}

export interface NumberRule {
  label: string
  min?: number
  max?: number
  integer?: boolean
  required?: boolean
  /** true: value must be strictly greater than min */
  exclusiveMin?: boolean
}

/** Parse and validate a numeric text field. Returns the number or an error message. */
export function parseNumber(raw: string, rule: NumberRule): { value: number | null; error: string | null } {
  const text = raw.trim()
  if (text === '') {
    return rule.required ? { value: null, error: `${rule.label} is required.` } : { value: null, error: null }
  }
  const value = Number(text)
  if (!Number.isFinite(value)) return { value: null, error: `${rule.label} must be a number.` }
  if (rule.integer && !Number.isInteger(value)) return { value: null, error: `${rule.label} must be a whole number.` }
  if (rule.min !== undefined) {
    if (rule.exclusiveMin ? value <= rule.min : value < rule.min) {
      return { value: null, error: `${rule.label} must be ${rule.exclusiveMin ? 'greater than' : 'at least'} ${rule.min}.` }
    }
  }
  if (rule.max !== undefined && value > rule.max) return { value: null, error: `${rule.label} must be at most ${rule.max}.` }
  return { value, error: null }
}

export function validateName(raw: string, label = 'Name', max = 120): string | null {
  const text = raw.trim()
  if (!text) return `${label} is required.`
  if (text.length > max) return `${label} must be at most ${max} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(text)) return `${label} contains invalid characters.`
  return null
}
