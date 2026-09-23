import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingState } from '@/components/ui/States'
import { ToastProvider } from '@/components/ui/Toast'
import LandingPage from '@/pages/landing/LandingPage'
import NotFoundPage from '@/pages/NotFoundPage'

const ProjectsPage = lazy(() => import('@/pages/projects/ProjectsPage'))
const WorkspaceRoute = lazy(() => import('@/pages/workspace/WorkspaceRoute'))
const pages = {
  overview: lazy(() => import('@/pages/workspace/overview/OverviewPage')),
  cameras: lazy(() => import('@/pages/workspace/cameras/CamerasPage')),
  calibration: lazy(() => import('@/pages/workspace/calibration/CalibrationPage')),
  matching: lazy(() => import('@/pages/workspace/matching/MatchingPage')),
  depth: lazy(() => import('@/pages/workspace/depth/DepthPage')),
  reconstruction: lazy(() => import('@/pages/workspace/reconstruction/ReconstructionPage')),
  detection: lazy(() => import('@/pages/workspace/detection/DetectionPage')),
  tracking: lazy(() => import('@/pages/workspace/tracking/TrackingPage')),
  'scene-graph': lazy(() => import('@/pages/workspace/scene-graph/SceneGraphPage')),
  viewer: lazy(() => import('@/pages/workspace/viewer/ViewerPage')),
  analysis: lazy(() => import('@/pages/workspace/analysis/AnalysisPage')),
  export: lazy(() => import('@/pages/workspace/export/ExportPage')),
  settings: lazy(() => import('@/pages/workspace/settings/SettingsPage')),
}

const fallback = <LoadingState label="Loading…" />

const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  {
    path: '/projects',
    element: (
      <Suspense fallback={fallback}>
        <ProjectsPage />
      </Suspense>
    ),
  },
  {
    path: '/projects/:projectId',
    element: (
      <Suspense fallback={fallback}>
        <WorkspaceRoute />
      </Suspense>
    ),
    children: [
      { index: true, element: <Navigate to="overview" replace /> },
      ...Object.entries(pages).map(([path, Page]) => ({
        path,
        element: (
          <Suspense fallback={fallback}>
            <Page />
          </Suspense>
        ),
      })),
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])

export default function App() {
  return (
    <ErrorBoundary area="application">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  )
}
