import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import { Building2, RotateCcw } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { getAdminBuildingAnalytics, getApiErrorMessage } from '../services/api.js'

function buildingColor(count) {
  if (count === 0) return '#48b989'
  if (count < 5) return '#e8b65f'
  return '#e8787c'
}

function formatDuration(hours) {
  if (hours === null || hours === undefined) return 'Not enough data'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 24) return `${Math.round(hours)} hr`
  return `${(hours / 24).toFixed(1)} days`
}

function BuildingBlock({ building, selected, onSelect, reducedMotion }) {
  const mesh = useRef(null)
  const [hovered, setHovered] = useState(false)
  const color = buildingColor(building.open_complaint_count)
  const [width, height, depth] = building.size
  const floorCount = building.floors.length

  useFrame((_, delta) => {
    if (!mesh.current) return
    if (reducedMotion) {
      mesh.current.scale.setScalar(1)
      return
    }
    const targetScale = hovered || selected ? 1.045 : 1
    const easing = 1 - Math.exp(-delta * 9)
    mesh.current.scale.setScalar(
      mesh.current.scale.x + (targetScale - mesh.current.scale.x) * easing,
    )
  })

  function choose(event) {
    event.stopPropagation()
    onSelect(building)
  }

  return (
    <group position={building.position}>
      <mesh
        ref={mesh}
        position={[0, height / 2, 0]}
        onClick={choose}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={building.size} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered || selected ? 0.22 : 0.06}
          roughness={0.58}
          metalness={0.08}
        />
        <Edges color={hovered || selected ? '#e5f1ff' : '#8298b4'} scale={1.004} />
      </mesh>
      {building.floors.slice(1).map((floor, index) => (
        <mesh
          key={floor}
          position={[0, ((index + 1) * height) / floorCount, 0]}
          raycast={() => null}
        >
          <boxGeometry args={[width + 0.025, 0.018, depth + 0.025]} />
          <meshBasicMaterial color="#d7e8fb" transparent opacity={0.34} />
        </mesh>
      ))}
    </group>
  )
}

function CampusScene({ buildings, selectedKey, onSelect, reducedMotion }) {
  return (
    <>
      <color attach="background" args={['#0a1422']} />
      <fog attach="fog" args={['#0a1422', 23, 45]} />
      <ambientLight intensity={1.25} />
      <directionalLight position={[8, 15, 8]} intensity={2.2} castShadow />
      <mesh position={[0, -0.08, 0]}>
        <boxGeometry args={[28, 0.16, 23]} />
        <meshStandardMaterial color="#142438" roughness={0.9} />
      </mesh>
      {buildings.map((building) => (
        <BuildingBlock
          key={building.key}
          building={building}
          selected={building.key === selectedKey}
          onSelect={onSelect}
          reducedMotion={reducedMotion}
        />
      ))}
      <OrbitControls
        makeDefault
        enableDamping={!reducedMotion}
        dampingFactor={0.09}
        minDistance={12}
        maxDistance={34}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  )
}

function BuildingTable({ buildings, onSelect }) {
  return (
    <div className="campus-fallback" role="region" aria-label="Campus buildings table">
      <p className="campus-fallback__notice">
        3D view isn’t available in this browser. You can still explore building activity here.
      </p>
      <div className="campus-table-wrap">
        <table className="campus-table">
          <thead>
            <tr>
              <th scope="col">Building</th>
              <th scope="col">Open requests</th>
              <th scope="col">Floor breakdown</th>
              <th scope="col">Avg. repair time</th>
            </tr>
          </thead>
          <tbody>
            {buildings.map((building) => (
              <tr key={building.key}>
                <th scope="row">
                  <button className="campus-table__building" type="button" onClick={() => onSelect(building)}>
                    <span className="campus-table__dot" style={{ backgroundColor: buildingColor(building.open_complaint_count) }} />
                    {building.name}
                  </button>
                </th>
                <td>{building.open_complaint_count}</td>
                <td>{building.floor_counts.map((item) => `${item.floor}: ${item.open_complaint_count}`).join(' · ')}</td>
                <td>{formatDuration(building.average_resolution_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CampusBuildingLabels({ buildings, selectedKey, onSelect }) {
  return (
    <div className="campus-map-labels" aria-label="Select a campus building">
      {buildings.map((building) => (
        <button
          className={`campus-map-label${building.key === selectedKey ? ' is-selected' : ''}`}
          key={building.key}
          type="button"
          aria-pressed={building.key === selectedKey}
          onClick={() => onSelect(building)}
        >
          <span className="campus-map-label__dot" style={{ backgroundColor: buildingColor(building.open_complaint_count) }} />
          <span className="campus-map-label__copy">
            <strong>{building.name}</strong>
            <small>{building.open_complaint_count} open</small>
          </span>
        </button>
      ))}
    </div>
  )
}

function BuildingDetails({ building, onClose, onOpenComplaint }) {
  if (!building) {
    return (
      <aside className="campus-details glass-card">
        <span className="campus-details__icon"><Building2 size={20} aria-hidden="true" /></span>
        <h2>Select a building</h2>
        <p>Choose a block in the map or table to see floor activity and recent requests.</p>
      </aside>
    )
  }

  const severity = building.open_complaint_count === 0
    ? 'green'
    : building.open_complaint_count < 5
      ? 'amber'
      : 'red'

  return (
    <aside className="campus-details glass-card" aria-labelledby="campus-details-heading">
      <div className="campus-details__heading">
        <div>
          <p className="eyebrow">BUILDING OVERVIEW</p>
          <h2 id="campus-details-heading">{building.name}</h2>
        </div>
        <button className="campus-details__close" type="button" aria-label="Close building details" onClick={onClose}>×</button>
      </div>
      <div className="campus-details__metric">
        <strong>{building.open_complaint_count}</strong>
        <span>open {building.open_complaint_count === 1 ? 'request' : 'requests'}</span>
        <span className={`campus-severity campus-severity--${severity}`}>
          {building.open_complaint_count === 0 ? 'On track' : building.open_complaint_count < 5 ? 'Needs attention' : 'High activity'}
        </span>
      </div>
      <section className="campus-details__section">
        <div className="campus-details__section-heading">
          <h3>By floor</h3>
          <span>Open requests</span>
        </div>
        <ul className="campus-floor-list">
          {building.floor_counts.map((floor) => (
            <li key={floor.floor}>
              <span>{floor.floor === 'Ground' ? 'Ground floor' : floor.floor === 'Unknown' ? 'Floor not identified' : `Floor ${floor.floor}`}</span>
              <strong>{floor.open_complaint_count}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section className="campus-details__section">
        <div className="campus-details__section-heading">
          <h3>By category</h3>
          <span>Open requests</span>
        </div>
        {building.category_counts.length > 0 ? (
          <ul className="campus-category-list">
            {building.category_counts.map((item) => (
              <li key={item.category}><span>{item.category}</span><strong>{item.open_complaint_count}</strong></li>
            ))}
          </ul>
        ) : <p className="campus-details__empty">No open requests for this building.</p>}
      </section>
      <section className="campus-details__section campus-details__section--recent">
        <div className="campus-details__section-heading">
          <h3>Recent requests</h3>
          <span>{building.recent_complaints.length}</span>
        </div>
        {building.recent_complaints.length > 0 ? (
          <ul className="campus-complaint-list">
            {building.recent_complaints.map((complaint) => (
              <li key={complaint.id}>
                <button type="button" onClick={() => onOpenComplaint(complaint.id)}>
                  <span className="campus-complaint-list__copy">
                    <strong>{complaint.title}</strong>
                    <small>{complaint.category} · {complaint.floor === 'Unknown' ? complaint.location : `${complaint.floor} floor`}</small>
                  </span>
                  <span className={`status-badge status-badge--${complaint.status.toLowerCase().replaceAll(' ', '-')}`}>
                    {complaint.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="campus-details__empty">No recent complaints are mapped here.</p>}
      </section>
      <div className="campus-details__resolution">
        <span>Average repair time</span>
        <strong>{formatDuration(building.average_resolution_hours)}</strong>
      </div>
    </aside>
  )
}

class CampusSceneErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Campus 3D view could not be rendered.', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="campus-scene-error" role="alert">
          <p>The 3D view couldn’t start. Use the building table instead.</p>
          <BuildingTable buildings={this.props.buildings} onSelect={this.props.onSelect} />
        </div>
      )
    }
    return this.props.children
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
    return Boolean(context)
  } catch {
    return false
  }
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (event) => setReducedMotion(event.matches)
    preference.addEventListener('change', updatePreference)
    return () => preference.removeEventListener('change', updatePreference)
  }, [])

  return reducedMotion
}

function Campus3DPage() {
  const navigate = useNavigate()
  const reducedMotion = usePrefersReducedMotion()
  const [analytics, setAnalytics] = useState(null)
  const [selected, setSelected] = useState(null)
  const [webglAvailable] = useState(() => (
    typeof document === 'undefined' ? false : supportsWebGL()
  ))
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const fetchAnalytics = useCallback(async () => {
    const { data } = await getAdminBuildingAnalytics()
    return data
  }, [])

  const loadAnalytics = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      setAnalytics(await fetchAnalytics())
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load campus analytics.'))
    } finally {
      setIsLoading(false)
    }
  }, [fetchAnalytics])

  useEffect(() => {
    let active = true
    fetchAnalytics()
      .then((data) => {
        if (active) setAnalytics(data)
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Unable to load campus analytics.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [fetchAnalytics])

  const buildings = analytics?.buildings ?? []
  const selectedBuilding = selected
    ? buildings.find((building) => building.key === selected.key) ?? null
    : null
  const totals = analytics?.totals

  return (
    <WorkspaceLayout title="Campus 3D">
      <div className="campus-intro">
        <div>
          <p>Explore requests across campus. Select a building to see its floors and recent activity.</p>
        </div>
        <button className="button button--secondary campus-refresh" type="button" disabled={isLoading} onClick={loadAnalytics}>
          <RotateCcw size={15} aria-hidden="true" /> Refresh data
        </button>
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <section className="workspace-summary campus-summary">
        <div className="workspace-summary__card"><span className="eyebrow">OPEN REQUESTS</span><strong>{isLoading || error ? '—' : totals.open_complaints}</strong><span>Across campus</span></div>
        <div className="workspace-summary__card"><span className="eyebrow">MAPPED</span><strong>{isLoading || error ? '—' : totals.mapped_open_complaints}</strong><span>Assigned to a building</span></div>
        <div className="workspace-summary__card"><span className="eyebrow">AVG. REPAIR TIME</span><strong>{isLoading || error ? '—' : formatDuration(totals.average_resolution_hours)}</strong><span>Resolved requests only</span></div>
        <div className="workspace-summary__card"><span className="eyebrow">NEEDS MAPPING</span><strong>{isLoading || error ? '—' : totals.unmapped_open_complaints}</strong><span>Open requests with unknown location</span></div>
      </section>
      {isLoading && <div className="workspace-empty">Loading campus activity…</div>}
      {!isLoading && !error && (
        <>
          {totals.unmapped_open_complaints > 0 && (
            <p className="campus-unmapped" role="status">
              {totals.unmapped_open_complaints} open {totals.unmapped_open_complaints === 1 ? 'request needs' : 'requests need'} a building mapping.
              {' '}Map QR locations in <Link to="/admin/qr-codes">Locations</Link> or update the building aliases in the campus config.
            </p>
          )}
          <div className="campus-legend" aria-label="Open request color legend">
            <span><i className="campus-legend__dot campus-legend__dot--green" />No open requests</span>
            <span><i className="campus-legend__dot campus-legend__dot--amber" />1–4 open requests</span>
            <span><i className="campus-legend__dot campus-legend__dot--red" />5+ open requests</span>
            <small>Drag to orbit · scroll to zoom</small>
          </div>
          <div className="campus-layout">
            <section className="campus-map-panel glass-card" aria-label="Campus building map">
              {webglAvailable === false ? (
                <BuildingTable buildings={buildings} onSelect={setSelected} />
              ) : (
                <CampusSceneErrorBoundary buildings={buildings} onSelect={setSelected}>
                  <div className="campus-3d-canvas">
                    <Canvas
                      dpr={[1, 1.5]}
                      camera={{ position: [15, 15, 19], fov: 42 }}
                      aria-label="Interactive 3D campus buildings"
                      onPointerMissed={() => setSelected(null)}
                    >
                      <CampusScene
                        buildings={buildings}
                        selectedKey={selectedBuilding?.key}
                        onSelect={setSelected}
                        reducedMotion={reducedMotion}
                      />
                    </Canvas>
                    <CampusBuildingLabels
                      buildings={buildings}
                      selectedKey={selectedBuilding?.key}
                      onSelect={setSelected}
                    />
                  </div>
                </CampusSceneErrorBoundary>
              )}
            </section>
            <BuildingDetails
              building={selectedBuilding}
              onClose={() => setSelected(null)}
              onOpenComplaint={(complaintId) => navigate(`/complaints/${complaintId}`)}
            />
          </div>
        </>
      )}
    </WorkspaceLayout>
  )
}

export default Campus3DPage
