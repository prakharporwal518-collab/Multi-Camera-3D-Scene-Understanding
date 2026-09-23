import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { DecodedDepth } from '@/services/depthCodec'
import { colorize } from '@/services/depthCodec'
import { fmtNumber } from '@/utils/format'

export type DepthView = 'rgb' | 'depth' | 'confidence'

interface DepthCanvasProps {
  decoded: DecodedDepth
  view: DepthView
  rgbUrl: string
  range: [number, number]
  unit: string
  label: string
}

interface Hover {
  u: number
  v: number
  depth: number
  confidence: number
  x: number
  y: number
}

export function DepthCanvas({ decoded, view, rgbUrl, range, unit, label }: DepthCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [rgbFailed, setRgbFailed] = useState(false)
  const { width, height } = decoded

  const image = useMemo(() => {
    if (view === 'rgb') return null
    const data = new ImageData(width, height)
    if (view === 'depth') colorize(decoded.depth, decoded.depth, range[0], range[1], data.data, true)
    else colorize(decoded.confidence, decoded.depth, 0, 1, data.data)
    return data
  }, [decoded, view, range, width, height])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    if (image) ctx.putImageData(image, 0, 0)
  }, [image, width, height])

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const u = Math.floor(((e.clientX - rect.left) / rect.width) * width)
    const v = Math.floor(((e.clientY - rect.top) / rect.height) * height)
    if (u < 0 || v < 0 || u >= width || v >= height) return setHover(null)
    const i = v * width + u
    setHover({ u, v, depth: decoded.depth[i], confidence: decoded.confidence[i], x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div
      style={{ position: 'relative', aspectRatio: `${width} / ${height}`, background: '#0f1113', borderRadius: 4, overflow: 'hidden' }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {view === 'rgb' ? (
        rgbFailed ? (
          <p className="faint" style={{ padding: 16 }}>
            The RGB frame could not be loaded.
          </p>
        ) : (
          <img src={rgbUrl} alt={`${label} RGB frame`} style={{ width: '100%', height: '100%', display: 'block' }} onError={() => setRgbFailed(true)} />
        )
      ) : (
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }}
          role="img"
          aria-label={`${label} ${view} map; transparent pixels have no estimate`}
        />
      )}
      {hover && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hover.x + 12, 9999),
            top: hover.y + 12,
            padding: '4px 6px',
            background: 'rgb(15 17 19 / 0.9)',
            border: '1px solid var(--border-strong)',
            borderRadius: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          ({hover.u}, {hover.v}){' '}
          {hover.depth > 0 ? `z = ${fmtNumber(hover.depth, 2)} ${unit} · conf ${fmtNumber(hover.confidence, 2)}` : 'no estimate'}
        </div>
      )}
    </div>
  )
}

export function ColorScale({ min, max, unit, label }: { min: number; max: number; unit: string; label: string }) {
  return (
    <div aria-label={`${label} colour scale from ${fmtNumber(min, 2)} to ${fmtNumber(max, 2)} ${unit}`} role="img">
      <div
        style={{
          height: 10,
          borderRadius: 2,
          background:
            'linear-gradient(90deg, rgb(122 4 3), rgb(236 91 21), rgb(242 200 57), rgb(163 253 61), rgb(26 229 182), rgb(64 145 245), rgb(48 18 59))',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }} className="num faint">
        <span>
          {fmtNumber(min, 2)} {unit}
        </span>
        <span>{label}</span>
        <span>
          {fmtNumber(max, 2)} {unit}
        </span>
      </div>
    </div>
  )
}
