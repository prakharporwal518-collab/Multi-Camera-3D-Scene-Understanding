import type { ApiErrorBody } from '@/types/scene'
import { API_URL, apiHost } from './env'

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'unconfigured' | 'parse'

/** Every failure that reaches the UI is an ApiError with a message written for people. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly code: string
  readonly hint?: string
  readonly details?: Record<string, unknown>

  constructor(
    kind: ApiErrorKind,
    message: string,
    opts: { status?: number | null; code?: string; hint?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = opts.status ?? null
    this.code = opts.code ?? kind
    this.hint = opts.hint
    this.details = opts.details
  }

  get isBackendUnavailable(): boolean {
    return this.kind === 'network' || this.kind === 'unconfigured' || this.kind === 'timeout' || this.status === 502 || this.status === 503
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof DOMException && err.name === 'AbortError') return new ApiError('aborted', 'The request was cancelled.')
  const message = err instanceof Error ? err.message : String(err)
  return new ApiError('parse', message || 'Something went wrong.')
}

const DEFAULT_TIMEOUT_MS = 20_000

function unconfiguredError(): ApiError {
  return new ApiError('unconfigured', 'No processing backend is configured for this deployment.', {
    hint: 'Set VITE_API_URL to the FastAPI server to create projects. The demo project works without it.',
  })
}

function networkError(): ApiError {
  return new ApiError('network', `The processing server (${apiHost()}) could not be reached.`, {
    hint: 'Check that the backend is running and that VITE_API_URL points to it.',
  })
}

function timeoutError(ms: number): ApiError {
  return new ApiError('timeout', `The server did not respond within ${Math.round(ms / 1000)} s.`, {
    hint: 'The server may be overloaded. Try again in a moment.',
  })
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  const body: { error?: ApiErrorBody } | null = await res.json().catch(() => null)
  if (body?.error?.message) {
    const e = body.error
    return new ApiError('http', e.message, { status: res.status, code: e.code, hint: e.hint, details: e.details })
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError('http', `The processing server is temporarily unavailable (HTTP ${res.status}).`, {
      status: res.status,
      code: 'service_unavailable',
      hint: 'Hosted backends on free tiers can take up to a minute to wake up. Retry shortly.',
    })
  }
  return new ApiError('http', `The server returned an unexpected response (HTTP ${res.status}).`, { status: res.status })
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!API_URL) throw unconfiguredError()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const onAbort = () => controller.abort('caller')
  opts.signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) throw await errorFromResponse(res)
    if (res.status === 204) return undefined as T
    try {
      return (await res.json()) as T
    } catch {
      throw new ApiError('parse', 'The server response could not be read.', { status: res.status })
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (controller.signal.aborted) {
      if (controller.signal.reason === 'timeout') throw timeoutError(timeoutMs)
      throw new ApiError('aborted', 'The request was cancelled.')
    }
    throw networkError()
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Multipart upload through XHR, which (unlike fetch) reports upload progress. */
export function apiUpload<T>(path: string, form: FormData, opts: UploadOptions = {}): Promise<T> {
  if (!API_URL) return Promise.reject(unconfiguredError())
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}${path}`)
    xhr.responseType = 'text'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      const res = new Response(xhr.responseText, { status: xhr.status, headers: { 'Content-Type': 'application/json' } })
      if (xhr.status >= 200 && xhr.status < 300) {
        res.json().then(resolve, () => reject(new ApiError('parse', 'The server response could not be read.')))
      } else {
        errorFromResponse(res).then(reject)
      }
    }
    xhr.onerror = () => reject(networkError())
    xhr.onabort = () => reject(new ApiError('aborted', 'The upload was cancelled.'))
    opts.signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}

export function apiUrl(path: string): string {
  if (!API_URL) throw unconfiguredError()
  return `${API_URL}${path}`
}
