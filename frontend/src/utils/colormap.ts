/**
 * Turbo colormap (Mikhail, Google 2019), polynomial approximation.
 * Perceptually smoother than jet and readable for both near and far depth.
 */
export function turbo(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t))
  const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))))
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))))
  const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))))
  return [clampByte(r * 255), clampByte(g * 255), clampByte(b * 255)]
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** 256-entry lookup table, so per-pixel colouring is an array index. */
export const TURBO_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) lut.set(turbo(i / 255), i * 3)
  return lut
})()

