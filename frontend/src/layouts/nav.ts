import type { IconName } from '@/components/ui/Icon'

export interface NavItem {
  path: string
  label: string
  icon: IconName
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Input',
    items: [
      { path: 'overview', label: 'Overview', icon: 'overview' },
      { path: 'cameras', label: 'Camera Inputs', icon: 'camera' },
      { path: 'calibration', label: 'Calibration', icon: 'calibration' },
    ],
  },
  {
    title: 'Geometry',
    items: [
      { path: 'matching', label: 'Feature Matching', icon: 'matching' },
      { path: 'depth', label: 'Depth', icon: 'depth' },
      { path: 'reconstruction', label: '3D Reconstruction', icon: 'cube' },
    ],
  },
  {
    title: 'Understanding',
    items: [
      { path: 'detection', label: 'Object Detection', icon: 'detection' },
      { path: 'tracking', label: 'Tracking', icon: 'tracking' },
      { path: 'scene-graph', label: 'Scene Graph', icon: 'graph' },
    ],
  },
  {
    title: 'Inspect',
    items: [
      { path: 'viewer', label: '3D Viewer', icon: 'viewer' },
      { path: 'analysis', label: 'Analysis', icon: 'analysis' },
      { path: 'export', label: 'Export', icon: 'export' },
    ],
  },
]

export const SETTINGS_ITEM: NavItem = { path: 'settings', label: 'Settings', icon: 'settings' }
