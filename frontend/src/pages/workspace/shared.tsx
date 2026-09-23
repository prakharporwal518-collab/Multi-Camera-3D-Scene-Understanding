import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { SceneDocument } from '@/types/scene'
import s from './page.module.css'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.header}>
      <div className={s.headerText}>
        <h1 className={s.title}>{title}</h1>
        {description && <p className={s.description}>{description}</p>}
      </div>
      {actions && <div className={s.headerActions}>{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
      {note && <span className={s.statNote}>{note}</span>}
    </div>
  )
}

export function Note({ children, tone = 'neutral', icon = 'info' }: { children: ReactNode; tone?: 'neutral' | 'sample'; icon?: IconName }) {
  return (
    <div className={`${s.note} ${tone === 'sample' ? s.sampleNote : ''}`}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  )
}

/** Empty state shown on analysis pages when the project has no reconstruction yet. */
export function NoSceneState({ what = 'reconstruction' }: { what?: string }) {
  const navigate = useNavigate()
  const { isDemo } = useWorkspace()
  return (
    <EmptyState
      icon="cube"
      title={`No ${what} available yet.`}
      actions={
        <>
          <Button variant="primary" icon="play" onClick={() => navigate('../overview')}>
            Start Reconstruction
          </Button>
          {!isDemo && (
            <Button icon="external" onClick={() => navigate('/projects/demo/overview')}>
              Open Demo Project
            </Button>
          )}
        </>
      }
    >
      Add frames for at least two cameras, then run the pipeline from the Overview page.
    </EmptyState>
  )
}

/** Renders loading / error / empty states for the scene and calls `children` once it is available. */
export function SceneGate({ children, what }: { children: (scene: SceneDocument) => ReactNode; what?: string }) {
  const { scene } = useWorkspace()
  const st = scene.state
  if (st.status === 'loading' && !st.data) return <LoadingState label="Loading scene…" />
  if (st.status === 'error' && !st.data) {
    return <ErrorState error={st.error} title="The scene could not be loaded" onRetry={scene.reload} />
  }
  if (!st.data) return <NoSceneState what={what} />
  return <>{children(st.data)}</>
}
