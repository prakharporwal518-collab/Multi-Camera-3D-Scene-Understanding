import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/Progress'
import type { MatchData } from '@/services/sceneSource'
import type { SceneCamera } from '@/types/scene'

interface MatchCanvasProps {
  camA: SceneCamera
  camB: SceneCamera
  srcA: string
  srcB: string
  data: MatchData | null
  showOutliers: boolean
  maxLines: number
  layout: 'row' | 'column'
}

const INLIER = 'rgba(106, 165, 240, 0.85)'
const OUTLIER = 'rgba(226, 99, 92, 0.75)'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image ${src.split('/').pop()} could not be loaded`))
    img.src = src
  })
}

/** Evenly thin a list so that at most `n` items are drawn (keeps spatial coverage). */
function thin<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items
  const step = items.length / n
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)])
}

export function MatchCanvas({ camA, camB, srcA, srcB, data, showOutliers, maxLines, layout }: MatchCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<[HTMLImageElement, HTMLImageElement] | null>(null)
  const [imgError, setImgError] = useState<string | null>(null)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    let alive = true
    setImages(null)
    setImgError(null)
    Promise.all([loadImage(srcA), loadImage(srcB)]).then(
      (imgs) => alive && setImages(imgs as [HTMLImageElement, HTMLImageElement]),
      (err: Error) => alive && setImgError(err.message),
    )
    return () => {
      alive = false
    }
  }, [srcA, srcB])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !images) return
    const gap = 8
    const row = layout === 'row'
    const tileW = row ? (width - gap) / 2 : width
    const scaleA = tileW / camA.width
    const scaleB = tileW / camB.width
    const hA = camA.height * scaleA
    const hB = camB.height * scaleB
    const cssH = row ? Math.max(hA, hB) : hA + gap + hB
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.height = `${cssH}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, cssH)
    const offB: [number, number] = row ? [tileW + gap, 0] : [0, hA + gap]
    ctx.drawImage(images[0], 0, 0, tileW, hA)
    ctx.drawImage(images[1], offB[0], offB[1], tileW, hB)
    if (!data) return

    const rows = data.matches.filter((m) => m[4] || showOutliers)
    const drawn = thin(rows, maxLines)
    ctx.lineWidth = 1
    for (const [xa, ya, xb, yb, inlier] of drawn) {
      ctx.strokeStyle = inlier ? INLIER : OUTLIER
      ctx.beginPath()
      ctx.moveTo(xa * scaleA, ya * scaleA)
      ctx.lineTo(offB[0] + xb * scaleB, offB[1] + yb * scaleB)
      ctx.stroke()
    }
    for (const [xa, ya, xb, yb, inlier] of drawn) {
      ctx.fillStyle = inlier ? INLIER : OUTLIER
      ctx.fillRect(xa * scaleA - 1.5, ya * scaleA - 1.5, 3, 3)
      ctx.fillRect(offB[0] + xb * scaleB - 1.5, offB[1] + yb * scaleB - 1.5, 3, 3)
    }
  }, [images, data, showOutliers, maxLines, width, layout, camA, camB])

  const inliers = data?.matches.filter((m) => m[4]).length ?? 0
  return (
    <div ref={wrapRef} style={{ position: 'relative', minHeight: 160 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%' }}
        role="img"
        aria-label={
          data
            ? `${camA.label} and ${camB.label} with ${inliers} inlier matches${showOutliers ? ` and ${data.matches.length - inliers} rejected matches` : ''} drawn as lines`
            : `${camA.label} and ${camB.label}`
        }
      />
      {!images && !imgError && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Spinner label="Loading frames" />
        </div>
      )}
      {imgError && <p className="faint">{imgError}</p>}
    </div>
  )
}
