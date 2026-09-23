import { useNavigate } from 'react-router'
import { StatusPill } from '@/components/StatusPill'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/Progress'
import { ErrorNotice } from '@/components/ui/States'
import { ApiError } from '@/services/apiClient'
import type { StageId, StageRecord } from '@/types/scene'
import { fmtDuration } from '@/utils/format'
import s from './PipelineStages.module.css'

/** Page where the input for a stage is prepared, for the "Return to previous step" action. */
const STEP_PAGE: Partial<Record<StageId, { path: string; label: string }>> = {
  input: { path: '../cameras', label: 'Camera Inputs' },
  preprocessing: { path: '../cameras', label: 'Camera Inputs' },
  calibration: { path: '../calibration', label: 'Calibration' },
  feature_extraction: { path: '../settings', label: 'Settings' },
  feature_matching: { path: '../matching', label: 'Feature Matching' },
  pose_estimation: { path: '../matching', label: 'Feature Matching' },
  depth_estimation: { path: '../settings', label: 'Settings' },
  reconstruction: { path: '../cameras', label: 'Camera Inputs' },
}

interface PipelineStagesProps {
  stages: StageRecord[]
  onRetry?: () => void
  retrying?: boolean
}

export function PipelineStages({ stages, onRetry, retrying }: PipelineStagesProps) {
  const navigate = useNavigate()
  return (
    <ol className={s.list} aria-label="Pipeline stages">
      {stages.map((st, i) => {
        const step = STEP_PAGE[st.id]
        return (
          <li key={st.id} className={s.stage} data-status={st.status}>
            <span className={s.index}>{String(i + 1).padStart(2, '0')}</span>
            <span className={s.name}>{st.label}</span>
            <span className={s.status}>
              <StatusPill status={st.status} />
            </span>
            <span className={s.time}>{st.status === 'waiting' ? '' : fmtDuration(st.durationMs)}</span>
            <div className={s.detail}>
              {st.status === 'processing' && (
                <ProgressBar value={st.progress > 0 ? st.progress : undefined} label={`${st.label} progress`} />
              )}
              {st.message && st.status !== 'failed' && <span>{st.message}</span>}
              {st.warnings.length > 0 && (
                <ul className={s.warnings}>
                  {st.warnings.map((w, k) => (
                    <li key={k}>{w}</li>
                  ))}
                </ul>
              )}
              {st.status === 'failed' && (
                <ErrorNotice
                  error={
                    new ApiError('http', st.error?.message ?? st.message ?? 'This stage failed.', {
                      code: st.error?.code,
                      hint: st.error?.hint,
                      details: st.error?.details,
                    })
                  }
                  onRetry={onRetry}
                  retrying={retrying}
                  actions={
                    step && (
                      <Button size="sm" icon="arrowLeft" onClick={() => navigate(step.path)}>
                        Return to {step.label}
                      </Button>
                    )
                  }
                />
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
