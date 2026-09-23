import { useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/States'
import { WorkspaceProvider, useWorkspace } from '@/context/WorkspaceContext'
import { WorkspaceLayout } from '@/layouts/WorkspaceLayout'

function ProjectGuard() {
  const { isDemo, project } = useWorkspace()
  const navigate = useNavigate()
  const st = project.state
  // A missing project replaces the whole workspace; transient errors are shown per page.
  if (!isDemo && st.status === 'error' && st.error.status === 404) {
    return (
      <ErrorState
        error={st.error}
        actions={
          <Button size="sm" onClick={() => navigate('/projects')}>
            Back to projects
          </Button>
        }
      />
    )
  }
  return <WorkspaceLayout />
}

export default function WorkspaceRoute() {
  const { projectId = '' } = useParams()
  return (
    <WorkspaceProvider key={projectId} projectId={projectId}>
      <ProjectGuard />
    </WorkspaceProvider>
  )
}
