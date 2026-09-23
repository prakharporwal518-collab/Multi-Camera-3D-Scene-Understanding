import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { ProgressBar } from '@/components/ui/Progress'
import { useWorkspace } from '@/context/WorkspaceContext'
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from './nav'
import s from './WorkspaceLayout.module.css'

function NavEntry({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <li>
      <NavLink to={item.path} className={s.navLink} onClick={onNavigate}>
        <Icon name={item.icon} />
        {item.label}
      </NavLink>
    </li>
  )
}

function RunIndicator() {
  const { run, runActive } = useWorkspace()
  if (!run || !runActive) return null
  const current = run.stages.find((st) => st.status === 'processing')
  const done = run.stages.filter((st) => st.status !== 'waiting' && st.status !== 'processing').length
  const fraction = (done + (current?.progress ?? 0)) / run.stages.length
  return (
    <div className={s.runStatus} aria-live="polite">
      <span className={s.hideSm}>{current ? `${current.label}…` : 'Queued…'}</span>
      <div style={{ width: 90 }}>
        <ProgressBar value={fraction} label="Pipeline progress" />
      </div>
    </div>
  )
}

export function WorkspaceLayout() {
  const { isDemo, project, scene } = useWorkspace()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMenuOpen(false), [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const name = isDemo ? 'Demo Dataset' : (project.state.data?.name ?? (project.state.status === 'error' ? 'Unavailable project' : 'Loading…'))
  const stale = !isDemo && scene.state.data?.stale

  return (
    <div className={s.shell}>
      <a href="#workspace-main" className="skip-link">
        Skip to content
      </a>
      <aside className={s.sidebar} data-open={menuOpen} aria-label="Workspace navigation">
        <Link to="/" className={s.brand}>
          <span className={s.brandMark} aria-hidden="true">
            <Icon name="cube" size={14} />
          </span>
          MC-3D
        </Link>
        <nav className={s.nav}>
          {NAV_GROUPS.map((g) => (
            <div key={g.title}>
              <p className={s.groupTitle}>{g.title}</p>
              <ul className={s.navList}>
                {g.items.map((item) => (
                  <NavEntry key={item.path} item={item} onNavigate={() => setMenuOpen(false)} />
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className={s.sidebarFooter}>
          <ul className={s.navList}>
            <NavEntry item={SETTINGS_ITEM} onNavigate={() => setMenuOpen(false)} />
          </ul>
        </div>
      </aside>
      <div className={s.backdrop} data-open={menuOpen} onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <header className={s.topbar}>
        <Button
          className={s.menuButton}
          variant="ghost"
          icon="menu"
          label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        />
        <nav className={s.crumbs} aria-label="Breadcrumb">
          <Link to="/projects" className={s.hideSm}>
            Projects
          </Link>
          <Icon name="chevron" size={12} className={s.hideSm} />
          <span className={s.projectName} aria-current="page">
            {name}
          </span>
        </nav>
        <div className={s.topbarRight}>
          <RunIndicator />
          {stale && (
            <Badge tone="warn" icon="warning" title="Inputs or settings changed after the last run. Re-run the pipeline to update results.">
              Results out of date
            </Badge>
          )}
          {isDemo && (
            <Badge tone="sample" title="Synthetic scene; read-only. Nothing on these pages is measured real-world data.">
              Demo Dataset · read-only
            </Badge>
          )}
        </div>
      </header>

      <main className={s.main} id="workspace-main" tabIndex={-1}>
        <ErrorBoundary area="page" resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
