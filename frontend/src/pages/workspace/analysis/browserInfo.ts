export interface BrowserInfo {
  renderer: string | null
  dpr: number
  heapMb: number | null
  cores: number | null
}

/** GPU and memory details the browser is willing to expose (all optional). */
export function readBrowserInfo(): BrowserInfo {
  let renderer: string | null = null
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    renderer = null
  }
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return {
    renderer,
    dpr: window.devicePixelRatio || 1,
    heapMb: mem ? mem.usedJSHeapSize / 1024 / 1024 : null,
    cores: navigator.hardwareConcurrency ?? null,
  }
}
