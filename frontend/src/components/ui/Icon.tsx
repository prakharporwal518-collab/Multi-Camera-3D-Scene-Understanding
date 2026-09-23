import type { SVGProps } from 'react'

/** Hand-drawn 16px stroke icons. Kept local to avoid pulling in an icon library for ~25 glyphs. */
const PATHS = {
  overview: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  camera: 'M2 5h2.5l1.2-1.8h4.6L11.5 5H14v7.5H2zM8 10.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  calibration: 'M3 3h10v10H3zM3 8h10M8 3v10M5.5 5.5h.01M10.5 10.5h.01',
  matching: 'M3 4.5a1.5 1.5 0 1 0 0-.01M13 11.5a1.5 1.5 0 1 0 0-.01M3 11.5a1.5 1.5 0 1 0 0-.01M13 4.5a1.5 1.5 0 1 0 0-.01M4.4 4.6l7.2 6.8M4.5 11.5h7',
  depth: 'M2 13.5h12M3 11l3-4 2.5 2.5L11 5l2 3',
  cube: 'M8 1.8 13.5 5v6L8 14.2 2.5 11V5zM2.5 5 8 8.2 13.5 5M8 8.2v6',
  detection: 'M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3M5.5 5.5h5v5h-5z',
  tracking: 'M2 13c2-5 4-1 6-5s4-4 6-6M11.5 2H14v2.5',
  graph: 'M4 4.5a1.5 1.5 0 1 0 0-.01M12 4.5a1.5 1.5 0 1 0 0-.01M8 12.5a1.5 1.5 0 1 0 0-.01M5.4 4.5h5.2M4.8 5.8l2.4 5.4M11.2 5.8l-2.4 5.4',
  viewer: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  analysis: 'M2.5 13.5V2.5M2.5 13.5h11M5 11V8M8 11V5M11 11V7',
  export: 'M8 2v8M5 7l3 3 3-3M3 12v1.5h10V12',
  settings: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5l3 3 7-7',
  warning: 'M8 2 14.5 13.5h-13zM8 6.5v3.2M8 11.6h.01',
  error: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.2v4.3M8 4.8h.01',
  clock: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5',
  skip: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM4 12l8-8',
  upload: 'M8 11V2.5M5 5.5l3-3 3 3M3 10.5V13.5h10v-3',
  video: 'M2 4h8.5v8H2zM10.5 6.8 14 5v6l-3.5-1.8',
  images: 'M2 3.5h9v7H2zM5 13h9V6M3.5 9l2.2-2.5 2 2 1.3-1.2 1.5 1.7',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
  edit: 'M10.5 2.5l3 3L6 13H3v-3z',
  refresh: 'M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3',
  play: 'M5 3l8 5-8 5z',
  stop: 'M4 4h8v8H4z',
  external: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4',
  ruler: 'M2 11 11 2l3 3-9 9zM5 8l1.2 1.2M7 6l1.2 1.2M9 4l1.2 1.2',
  target: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 8h.01',
  menu: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  chevron: 'M6 3.5 10.5 8 6 12.5',
  arrowLeft: 'M13 8H3M7 4 3 8l4 4',
  github: 'M8 1.8a6.2 6.2 0 0 0-2 12.1c.3 0 .4-.1.4-.3v-1.2c-1.7.4-2.1-.8-2.1-.8-.3-.7-.7-.9-.7-.9-.6-.4 0-.4 0-.4.6 0 1 .6 1 .6.5 1 1.5.7 1.8.5.1-.4.2-.7.4-.8-1.4-.2-2.8-.7-2.8-3 0-.7.2-1.2.6-1.6-.1-.2-.3-.8.1-1.6 0 0 .5-.2 1.7.6a5.6 5.6 0 0 1 3 0c1.2-.8 1.7-.6 1.7-.6.3.8.1 1.4.1 1.6.4.4.6 1 .6 1.6 0 2.4-1.4 2.9-2.8 3 .2.2.4.6.4 1.1v1.7c0 .2.1.4.4.3A6.2 6.2 0 0 0 8 1.8z',
} as const

export type IconName = keyof typeof PATHS

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
