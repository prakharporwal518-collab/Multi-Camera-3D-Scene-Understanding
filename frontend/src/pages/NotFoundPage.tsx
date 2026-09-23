import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100%' }}>
      <EmptyState
        icon="warning"
        title="Page not found"
        actions={
          <>
            <Button icon="arrowLeft" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button variant="primary" onClick={() => navigate('/projects')}>
              Projects
            </Button>
          </>
        }
      >
        The address does not match any page. The project may have been deleted.
      </EmptyState>
    </div>
  )
}
