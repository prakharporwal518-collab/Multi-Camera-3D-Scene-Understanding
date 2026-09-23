import { useState } from 'react'

export type WebGLSupport = { supported: true } | { supported: false; reason: string }

function detectWebGL(): WebGLSupport {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) {
      return { supported: false, reason: 'This browser or device does not provide a WebGL context.' }
    }
    ;(gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext()
    return { supported: true }
  } catch (err) {
    return { supported: false, reason: err instanceof Error ? err.message : 'WebGL initialisation failed.' }
  }
}

let cached: WebGLSupport | null = null

export function useWebGLSupport(): WebGLSupport {
  const [support] = useState(() => (cached ??= detectWebGL()))
  return support
}
