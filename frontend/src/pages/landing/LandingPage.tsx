import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { fmtInt } from '@/utils/format'
import { LIMITATIONS, OUTPUTS, PIPELINE, REPO_URL, STACK } from './content'
import { useAsync } from '@/hooks/useAsync'
import { demoSource } from '@/services/sceneSource'
import { DemoPreview } from './DemoPreview'
import s from './landing.module.css'

function ArchitectureDiagram() {
  const box = (x: number, y: number, w: number, title: string, sub: string) => (
    <g>
      <rect x={x} y={y} width={w} height={54} rx={3} fill="#1b1e22" stroke="#3a4048" />
      <text x={x + 12} y={y + 22} fill="#e3e6ea" fontSize={13} fontWeight={500}>
        {title}
      </text>
      <text x={x + 12} y={y + 40} fill="#7c848e" fontSize={11} fontFamily="var(--font-mono)">
        {sub}
      </text>
    </g>
  )
  const arrow = (x1: number, x2: number, y: number, label: string) => (
    <g>
      <line x1={x1} y1={y} x2={x2 - 6} y2={y} stroke="#565e68" />
      <path d={`M${x2 - 6},${y - 4} L${x2},${y} L${x2 - 6},${y + 4}`} fill="#565e68" />
      <text x={(x1 + x2) / 2} y={y - 8} fill="#7c848e" fontSize={10.5} textAnchor="middle">
        {label}
      </text>
    </g>
  )
  return (
    <svg viewBox="0 0 980 150" width="100%" style={{ minWidth: 760 }} role="img" aria-label="Architecture: browser, REST API, pipeline workers, storage">
      {box(0, 20, 200, 'Browser (React)', 'viewer · charts · worker')}
      {arrow(200, 280, 47, 'REST / JSON')}
      {box(280, 20, 200, 'FastAPI', 'validation · uploads')}
      {arrow(480, 560, 47, 'submit run')}
      {box(560, 20, 200, 'Pipeline workers', 'OpenCV · NumPy · ONNX')}
      {arrow(760, 820, 47, 'write')}
      {box(820, 20, 160, 'Storage', 'frames · results')}
      {box(280, 92, 200, 'SQL database', 'projects · cameras · runs')}
      <line x1={380} y1={74} x2={380} y2={92} stroke="#565e68" />
      <text x={16} y={140} fill="#7c848e" fontSize={10.5}>
        The browser polls run status; results are served as a scene document plus binary point cloud and depth maps.
      </text>
    </svg>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const demo = useAsync((signal) => demoSource.loadScene(signal), [])
  const scene = demo.state.data

  return (
    <div className={s.root}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={s.nav}>
        <Link to="/" className={s.brand}>
          <Icon name="cube" /> MC-3D
        </Link>
        <nav className={s.navLinks} aria-label="Sections">
          <a href="#pipeline">Pipeline</a>
          <a href="#outputs">Outputs</a>
          <a href="#architecture">Architecture</a>
          <a href="#limitations">Limitations</a>
        </nav>
        <div className={s.navRight}>
          <Button size="sm" variant="ghost" icon="github" onClick={() => window.open(REPO_URL, '_blank', 'noopener')}>
            <span className={s.hideSm}>Source</span>
          </Button>
          <Button size="sm" onClick={() => navigate('/projects')}>
            Projects
          </Button>
        </div>
      </header>

      <main id="main">
        <section className={`${s.section} ${s.hero}`}>
          <div>
            <p className={s.eyebrow}>multi-view geometry · 3D detection · tracking</p>
            <h1 className={s.title}>Multi-Camera 3D Scene Understanding</h1>
            <p className={s.lede}>
              Reconstruct and inspect a 3D scene from synchronized multi-camera observations. Cameras are calibrated and
              registered, depth is estimated per view, and detected objects are placed, tracked and related in a shared world
              frame.
            </p>
            <div className={s.heroActions}>
              <Button variant="primary" icon="plus" onClick={() => navigate('/projects?new=1')}>
                Start New Reconstruction
              </Button>
              <Button icon="viewer" onClick={() => navigate('/projects/demo/overview')}>
                Open Demo Project
              </Button>
            </div>
            {scene && (
              <p className={s.facts} aria-label="Demo dataset figures">
                <span>demo: {scene.cameras.length} cameras</span>
                <span>{fmtInt(scene.pointCloud.count)} points</span>
                <span>{scene.tracks.length} tracks</span>
                <span>{scene.relations.length} relations</span>
              </p>
            )}
          </div>
          <div className={s.preview}>
            <DemoPreview scene={scene} />
          </div>
        </section>

        <section className={s.section} id="pipeline">
          <h2 className={s.sectionTitle}>Pipeline</h2>
          <p className={s.sectionLede}>
            Eleven stages run in order on the server. Each reports its status, time, progress and warnings, and a failure
            stops the run with an explanation instead of producing partial results silently.
          </p>
          <ol className={s.stages}>
            {PIPELINE.map((st, i) => (
              <li key={st.name}>
                <span className={s.stageNo}>{String(i + 1).padStart(2, '0')}</span>
                <span className={s.stageName}>{st.name}</span>
                <span className={s.stageMethod}>{st.method}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.section} id="outputs">
          <h2 className={s.sectionTitle}>Outputs</h2>
          <p className={s.sectionLede}>Every result has a page in the workspace and can be exported.</p>
          <div style={{ overflowX: 'auto' }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Output</th>
                  <th>Contents</th>
                  <th>
                    <span className="visually-hidden">Link</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {OUTPUTS.map((o) => (
                  <tr key={o.output}>
                    <td>{o.output}</td>
                    <td className="muted">{o.detail}</td>
                    <td>
                      <Link to={`/projects/demo/${o.page}`}>view in demo</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={s.section} id="architecture">
          <h2 className={s.sectionTitle}>Architecture</h2>
          <p className={s.sectionLede}>
            Frontend, API, processing and storage are separate layers. The demo runs entirely from static files, so the
            frontend can be deployed without a backend.
          </p>
          <div className={s.cols}>
            {STACK.map((c) => (
              <div key={c.title}>
                <h3>{c.title}</h3>
                <ul>
                  {c.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className={s.diagram}>
            <ArchitectureDiagram />
          </div>
        </section>

        <section className={s.section} id="limitations">
          <h2 className={s.sectionTitle}>Known limitations</h2>
          <ul className="muted" style={{ paddingLeft: 18, maxWidth: 820 }}>
            {LIMITATIONS.map((l) => (
              <li key={l} style={{ margin: '4px 0' }}>
                {l}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 12 }}>
            The demo dataset is a synthetic street scene rendered by the backend and processed by the same pipeline; its
            detections are simulated from ground truth and are labelled as such everywhere they appear.
          </p>
        </section>
      </main>

      <footer className={s.footer}>
        <span>Multi-Camera 3D Scene Understanding · MIT licence</span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  )
}
