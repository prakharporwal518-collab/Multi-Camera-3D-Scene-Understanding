/** Apply the OpenCV radial-tangential model to a normalized image point. */
export function distort(x: number, y: number, d: number[]): [number, number] {
  const [k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0] = d
  const r2 = x * x + y * y
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2
  return [x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x), y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y]
}
