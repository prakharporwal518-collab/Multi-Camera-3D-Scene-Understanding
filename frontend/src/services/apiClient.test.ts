import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ API_URL: 'https://api.test/api/v1', apiHost: () => 'api.test', DEMO_BASE: '/demo/' }))

const { apiRequest, ApiError } = await import('./apiClient')
type ApiErrorT = InstanceType<typeof ApiError>
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a rejection') }, (e: unknown) => e as ApiErrorT)

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns parsed JSON on success', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, { ok: 1 }))
    await expect(apiRequest('/health')).resolves.toEqual({ ok: 1 })
    expect(fetch).toHaveBeenCalledWith('https://api.test/api/v1/health', expect.objectContaining({ method: 'GET' }))
  })

  it('keeps the server message, code and hint', async () => {
    vi.mocked(fetch).mockResolvedValue(
      json(422, { error: { code: 'insufficient_matches', message: 'Only 7 matches.', hint: 'Add overlap.' } }),
    )
    const err = await failure(apiRequest('/x'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ kind: 'http', status: 422, code: 'insufficient_matches', message: 'Only 7 matches.', hint: 'Add overlap.' })
  })

  it('explains gateway errors without a JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))
    const err = await failure(apiRequest('/x'))
    expect(err.message).toContain('temporarily unavailable')
    expect(err.isBackendUnavailable).toBe(true)
  })

  it('never shows a bare status code for unknown errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('oops', { status: 500 }))
    const err = await failure(apiRequest('/x'))
    expect(err.message).toBe('The server returned an unexpected response (HTTP 500).')
  })

  it('maps connection failures to a network error with a hint', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await failure(apiRequest('/x'))
    expect(err).toMatchObject({ kind: 'network' })
    expect(err.message).toContain('api.test')
    expect(err.hint).toBeTruthy()
  })

  it('times out slow requests', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const err = await failure(apiRequest('/slow', { timeoutMs: 20 }))
    expect(err).toMatchObject({ kind: 'timeout' })
    expect(err.message).toContain('did not respond')
  })

  it('reports caller cancellation as aborted, not as a failure', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const controller = new AbortController()
    const pending = failure(apiRequest('/x', { signal: controller.signal }))
    controller.abort()
    expect(await pending).toMatchObject({ kind: 'aborted' })
  })

  it('sends JSON bodies and handles 204', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiRequest('/p/1', { method: 'DELETE' })).resolves.toBeUndefined()
    vi.mocked(fetch).mockResolvedValue(json(201, { id: 'a' }))
    await apiRequest('/p', { method: 'POST', body: { name: 'n' } })
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ body: '{"name":"n"}', headers: { 'Content-Type': 'application/json' } })
  })
})
