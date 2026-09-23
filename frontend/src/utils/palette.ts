/**
 * Categorical colours for cameras and object classes. Chosen to stay distinguishable on the
 * dark background and to avoid the red/orange/green used for status.
 */
const CAMERA_COLORS = ['#6aa5f0', '#c792ea', '#56c2c2', '#d7b56d', '#8fa6ff', '#e38fb4', '#7fc98b', '#b0b8c4']

export function cameraColor(index: number): string {
  return CAMERA_COLORS[((index % CAMERA_COLORS.length) + CAMERA_COLORS.length) % CAMERA_COLORS.length]
}

const CLASS_COLORS: Record<string, string> = {
  person: '#e8b86a',
  car: '#6aa5f0',
  truck: '#8fa6ff',
  bus: '#8fa6ff',
  bicycle: '#56c2c2',
  motorcycle: '#56c2c2',
  bench: '#b0b8c4',
}

export function classColor(cls: string): string {
  return CLASS_COLORS[cls] ?? '#c792ea'
}
