import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select, TextInput } from '@/components/ui/Form'
import { KeyValue } from '@/components/ui/KeyValue'
import { Panel } from '@/components/ui/Panel'
import { ErrorNotice, LoadingState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import uiStyles from '@/components/ui/ui.module.css'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { API_URL, apiHost } from '@/services/env'
import type { Project } from '@/types/project'
import { validateName } from '@/utils/validation'
import s from '../page.module.css'
import { Note, PageHeader } from '../shared'
import { RULES, toForm, validateForm, type ConfigForm, type NumericKey } from './configForm'

const GROUPS: { title: string; keys: NumericKey[] }[] = [
  { title: 'Features and matching', keys: ['maxFeatures', 'matchRatio'] },
  { title: 'Input and scale', keys: ['referenceFrame', 'baselineMeters', 'maxTimesteps', 'timestepStride'] },
  { title: 'Dense depth', keys: ['depth.numPlanes', 'depth.window', 'depth.workingWidth', 'depth.minScore', 'voxelSize'] },
  { title: 'Scene graph', keys: ['nearDistance'] },
]

export default function SettingsPage() {
  const { isDemo, project, scene } = useWorkspace()
  return (
    <div className={s.page}>
      <PageHeader title="Settings" description="Processing parameters for this project and the status of the processing server." />
      {isDemo ? (
        <Note tone="sample">
          The demo is read-only. It was processed with the default parameters and a known CAM-01 ↔ CAM-02 baseline
          {scene.state.data?.units === 'm' ? ', so its units are metres' : ''}.
        </Note>
      ) : project.state.status === 'error' ? (
        <ErrorNotice error={project.state.error} title="Project settings could not be loaded" onRetry={project.reload} />
      ) : !project.state.data ? (
        <LoadingState label="Loading settings…" />
      ) : (
        <ProjectSettings project={project.state.data} onSaved={project.reload} />
      )}
      <div className={s.grid2}>
        <BackendStatus />
        <BrowserPreferences />
      </div>
    </div>
  )
}

function ProjectSettings({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const { runActive } = useWorkspace()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [form, setForm] = useState<ConfigForm>(() => toForm(project.config))
  const [errors, setErrors] = useState<Partial<Record<NumericKey, string>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    setName(project.name)
    setDescription(project.description)
    setForm(toForm(project.config))
  }, [project])

  const nameError = validateName(name)
  const save = async () => {
    const { config, errors: errs } = validateForm(form)
    setErrors(errs)
    if (!config || nameError) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateProject(project.id, { name: name.trim(), description, config })
      toast.show('ok', 'Settings saved', 'Re-run the pipeline to apply processing changes.')
      onSaved()
    } catch (err) {
      setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Panel title="Project">
        <div className={s.grid2}>
          <TextInput label="Name" value={name} maxLength={120} error={nameError} onChange={setName} />
          <Field label="Description">
            {({ id }) => (
              <textarea id={id} className={uiStyles.input} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>
      </Panel>
      <Panel
        title="Processing"
        actions={
          <Button variant="primary" loading={saving} disabled={runActive} onClick={save}>
            Save settings
          </Button>
        }
      >
        <div className={s.controlsStack}>
          {runActive && <Note icon="clock">Settings are locked while the pipeline runs.</Note>}
          <div style={{ maxWidth: 320 }}>
            <Select
              label="Feature detector"
              value={form.detector}
              onChange={(v) => setForm((f) => ({ ...f, detector: v as ConfigForm['detector'] }))}
              options={[
                { value: 'sift', label: 'SIFT' },
                { value: 'orb', label: 'ORB' },
                { value: 'akaze', label: 'AKAZE' },
              ]}
            />
          </div>
          {GROUPS.map((g) => (
            <fieldset key={g.title} style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="faint" style={{ marginBottom: 6, fontSize: 'var(--fs-sm)' }}>
                {g.title}
              </legend>
              <div className={s.grid3}>
                {g.keys.map((k) => (
                  <TextInput
                    key={k}
                    label={RULES[k].label}
                    help={RULES[k].help}
                    mono
                    inputMode="decimal"
                    value={form[k]}
                    error={errors[k]}
                    onChange={(v) => setForm((f) => ({ ...f, [k]: v }))}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          {saveError !== null && <ErrorNotice error={saveError} title="Settings were not saved" />}
        </div>
      </Panel>
      <Panel title="Danger zone">
        <div className={s.toolbar}>
          <p className="muted" style={{ flex: 1 }}>
            Deleting the project removes its cameras, frames and results from the server.
          </p>
          <Button variant="danger" icon="trash" disabled={runActive} onClick={() => setDeleteOpen(true)}>
            Delete project
          </Button>
        </div>
      </Panel>
      <ConfirmDialog
        open={deleteOpen}
        title={`Delete “${project.name}”?`}
        confirmLabel="Delete project"
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await api.deleteProject(project.id)
          toast.show('ok', 'Project deleted')
          navigate('/projects')
        }}
      >
        {project.cameraCount} cameras and {project.frameCount} frames will be permanently deleted. This cannot be undone.
      </ConfirmDialog>
    </>
  )
}

function BackendStatus() {
  const health = useAsync((signal) => api.health(signal), [])
  const h = health.state.data
  return (
    <Panel title="Processing server" actions={<Button size="sm" variant="ghost" icon="refresh" label="Check again" onClick={health.reload} />}>
      {!API_URL ? (
        <p className="muted">No backend is configured (VITE_API_URL is unset). Only the demo project is available.</p>
      ) : health.state.status === 'error' ? (
        <ErrorNotice error={health.state.error} title="Server not reachable" onRetry={health.reload} />
      ) : !h ? (
        <LoadingState label="Contacting server…" />
      ) : (
        <KeyValue
          items={[
            ['Host', <span className="mono">{apiHost()}</span>],
            ['Status', <Badge tone={h.status === 'ok' ? 'ok' : 'warn'}>{h.status}</Badge>],
            ['API version', h.version],
            ['Database', h.database],
            [
              'Object detector',
              h.detector.status === 'ready' ? (
                <Badge tone="ok">{h.detector.message}</Badge>
              ) : (
                <span className="muted">{h.detector.status === 'error' ? h.detector.message : 'Not configured: detection stages are skipped'}</span>
              ),
            ],
            ['Upload limits', `${h.limits.maxImageMb} MB/image · ${h.limits.maxVideoMb} MB/video · ${h.limits.maxFramesPerCamera} frames/camera`],
            ['Timeout', `${h.limits.processingTimeoutS} s per run`],
          ]}
        />
      )}
    </Panel>
  )
}

function BrowserPreferences() {
  const toast = useToast()
  const reset = () => {
    try {
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('mc3d.'))
        .forEach((k) => window.localStorage.removeItem(k))
      toast.show('ok', 'Viewer preferences reset', 'Reload the 3D pages to see the defaults.')
    } catch {
      toast.show('warn', 'Browser storage is not available')
    }
  }
  return (
    <Panel title="This browser">
      <p className="muted" style={{ marginBottom: 10 }}>
        Viewer display options (layers, point size, density) are remembered in this browser only.
      </p>
      <Button onClick={reset}>Reset viewer preferences</Button>
    </Panel>
  )
}
