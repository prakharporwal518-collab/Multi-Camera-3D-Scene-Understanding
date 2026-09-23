import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { StatusPill } from '@/components/StatusPill'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, TextInput } from '@/components/ui/Form'
import { Icon } from '@/components/ui/Icon'
import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorNotice, LoadingState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import uiStyles from '@/components/ui/ui.module.css'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { API_URL } from '@/services/env'
import type { Project, RunStatus } from '@/types/project'
import type { StageStatus } from '@/types/scene'
import { fmtDate } from '@/utils/format'
import { validateName } from '@/utils/validation'
import s from './projects.module.css'

const RUN_TO_STAGE: Record<RunStatus, StageStatus> = {
  queued: 'waiting',
  running: 'processing',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'skipped',
}

function lastRunCell(p: Project) {
  if (!p.lastRun) return <span className="faint">never run</span>
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <StatusPill status={RUN_TO_STAGE[p.lastRun.status]} />
      {p.sceneStale && <Badge tone="warn">out of date</Badge>}
    </span>
  )
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const projects = useAsync((signal) => (API_URL ? api.listProjects(signal) : Promise.resolve(null)), [])

  useEffect(() => {
    if (params.get('new') === '1' && API_URL) setDialogOpen(true)
  }, [params])

  const closeDialog = () => {
    setDialogOpen(false)
    if (params.has('new')) setParams({}, { replace: true })
  }

  const list = projects.state.data ?? null
  return (
    <div className={s.page}>
      <div className={s.top}>
        <Link to="/" className={s.brand}>
          <Icon name="cube" /> MC-3D
        </Link>
      </div>
      <div className={s.header}>
        <div>
          <h1>Projects</h1>
          <p>Each project holds a set of cameras, their frames and the latest reconstruction.</p>
        </div>
        <div className={s.headerActions}>
          <Button variant="primary" icon="plus" disabled={!API_URL} onClick={() => setDialogOpen(true)}>
            New project
          </Button>
        </div>
      </div>

      <div className={s.stack}>
        {!API_URL && (
          <ErrorNotice
            tone="warn"
            error={new Error('No processing backend is configured for this deployment.')}
            title="Demo-only mode"
            actions={
              <Button size="sm" icon="viewer" onClick={() => navigate('/projects/demo/overview')}>
                Open Demo Project
              </Button>
            }
          />
        )}
        {projects.state.status === 'error' && (
          <ErrorNotice
            error={projects.state.error}
            title="Projects could not be loaded"
            onRetry={projects.reload}
            retrying={projects.refreshing}
            actions={
              <Button size="sm" icon="viewer" onClick={() => navigate('/projects/demo/overview')}>
                Open Demo Project
              </Button>
            }
          />
        )}

        <Panel flush>
          <div className={uiStyles.tableScroll}>
            <table className={uiStyles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className={s.hideSm}>Cameras</th>
                  <th className={s.hideSm}>Frames</th>
                  <th>Last run</th>
                  <th className={s.hideSm}>Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr data-clickable="true" onClick={() => navigate('/projects/demo/overview')}>
                  <td className={s.nameCell}>
                    <Link to="/projects/demo/overview" onClick={(e) => e.stopPropagation()}>
                      Demo Dataset
                    </Link>{' '}
                    <Badge tone="sample">synthetic · read-only</Badge>
                    <span className={s.desc}>Street scene rendered from four virtual cameras; processed by the real pipeline.</span>
                  </td>
                  <td className={`${s.hideSm} num`}>4</td>
                  <td className={`${s.hideSm} num`}>48</td>
                  <td>
                    <StatusPill status="completed" />
                  </td>
                  <td className={`${s.hideSm} faint`}>bundled</td>
                </tr>
                {list?.map((p) => (
                  <tr key={p.id} data-clickable="true" onClick={() => navigate(`/projects/${p.id}/overview`)}>
                    <td className={s.nameCell}>
                      <Link to={`/projects/${p.id}/overview`} onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      {p.description && <span className={s.desc}>{p.description}</span>}
                    </td>
                    <td className={`${s.hideSm} num`}>{p.cameraCount}</td>
                    <td className={`${s.hideSm} num`}>{p.frameCount}</td>
                    <td>{lastRunCell(p)}</td>
                    <td className={`${s.hideSm} faint`}>{fmtDate(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {projects.state.status === 'loading' && !list && API_URL && <LoadingState label="Loading projects…" />}
          {list && list.length === 0 && (
            <EmptyState
              compact
              icon="cube"
              title="No projects of your own yet"
              actions={
                <Button variant="primary" icon="plus" onClick={() => setDialogOpen(true)}>
                  New project
                </Button>
              }
            >
              Create a project, add two or more cameras and upload their frames.
            </EmptyState>
          )}
        </Panel>
      </div>

      <NewProjectDialog
        open={dialogOpen}
        onClose={closeDialog}
        onCreated={(p) => {
          toast.show('ok', `Project “${p.name}” created`, 'Add cameras and upload frames next.')
          navigate(`/projects/${p.id}/cameras`)
        }}
      />
    </div>
  )
}

function NewProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const nameError = touched ? validateName(name) : null

  const submit = async () => {
    setTouched(true)
    if (validateName(name)) return
    setBusy(true)
    setError(null)
    try {
      const p = await api.createProject(name.trim(), description.trim())
      setName('')
      setDescription('')
      setTouched(false)
      onClose()
      onCreated(p)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="New project"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Create project
          </Button>
        </>
      }
    >
      <TextInput
        label="Name"
        placeholder="e.g. Parking lot, north side"
        value={name}
        maxLength={120}
        error={nameError}
        onChange={setName}
        onBlur={() => setTouched(true)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoFocus
      />
      <Field label="Description (optional)">
        {({ id }) => (
          <textarea
            id={id}
            className={uiStyles.input}
            value={description}
            maxLength={2000}
            placeholder="Camera setup, capture date, notes…"
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      {error !== null && <ErrorNotice error={error} title="The project could not be created" />}
    </Dialog>
  )
}
