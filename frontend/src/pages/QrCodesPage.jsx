import { useEffect, useState } from 'react'
import { MapPinPlus } from 'lucide-react'
import QRCode from 'qrcode'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import {
  createLocation,
  getAdminBuildingAnalytics,
  getAdminLocations,
  getApiErrorMessage,
  updateLocationMapping,
} from '../services/api.js'

function LocationMapping({ location, buildings, isSaving, onSave }) {
  const [buildingKey, setBuildingKey] = useState(location.building_key || '')
  const [floor, setFloor] = useState(location.floor || '')

  const selectedBuilding = buildings.find((building) => building.key === buildingKey)

  function changeBuilding(event) {
    setBuildingKey(event.target.value)
    setFloor('')
  }

  return (
    <div className="location-mapping">
      <label className="form-field">
        <span>Building</span>
        <select value={buildingKey} onChange={changeBuilding}>
          <option value="">Not mapped</option>
          {buildings.map((building) => <option key={building.key} value={building.key}>{building.name}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span>Floor (optional)</span>
        <select value={floor} disabled={!selectedBuilding} onChange={(event) => setFloor(event.target.value)}>
          <option value="">Not specified</option>
          {selectedBuilding?.floors.map((item) => <option key={item} value={item}>{item === 'Ground' ? 'Ground floor' : `Floor ${item}`}</option>)}
        </select>
      </label>
      <button
        className="button button--secondary"
        disabled={isSaving || (buildingKey === (location.building_key || '') && floor === (location.floor || ''))}
        type="button"
        onClick={() => onSave(location.id, buildingKey || null, floor || null)}
      >
        {isSaving ? 'Saving…' : 'Save mapping'}
      </button>
    </div>
  )
}

function QrCodesPage() {
  const [locations, setLocations] = useState([])
  const [buildings, setBuildings] = useState([])
  const [codes, setCodes] = useState({})
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [buildingKey, setBuildingKey] = useState('')
  const [floor, setFloor] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savingLocationId, setSavingLocationId] = useState(null)

  async function loadLocations() {
    const [{ data }, { data: analytics }] = await Promise.all([
      getAdminLocations(),
      getAdminBuildingAnalytics(),
    ])
    setLocations(data.locations)
    setBuildings(analytics.buildings.map(({ key, name: buildingName, floors }) => ({
      key,
      name: buildingName,
      floors,
    })))
    const entries = await Promise.all(data.locations.map(async (location) => {
      const reportUrl = new URL('/report', window.location.origin)
      reportUrl.searchParams.set('location', location.id)
      return [location.id, await QRCode.toDataURL(reportUrl.toString(), {
        margin: 2,
        width: 256,
        color: { dark: '#192f51', light: '#ffffff' },
      })]
    }))
    setCodes(Object.fromEntries(entries))
  }

  useEffect(() => {
    Promise.resolve()
      .then(loadLocations)
      .catch((requestError) => setError(getApiErrorMessage(requestError, 'Unable to load locations.')))
      .finally(() => setIsLoading(false))
  }, [])

  async function addLocation(event) {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      await createLocation({
        name,
        details: details || null,
        building_key: buildingKey || null,
        floor: floor || null,
      })
      setName('')
      setDetails('')
      setBuildingKey('')
      setFloor('')
      await loadLocations()
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to create location.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function saveMapping(locationId, nextBuildingKey, nextFloor) {
    setError('')
    setSavingLocationId(locationId)
    try {
      const { data } = await updateLocationMapping(locationId, {
        building_key: nextBuildingKey,
        floor: nextFloor,
      })
      setLocations((current) => current.map((location) => (
        location.id === locationId
          ? { ...location, building_key: data.building_key, floor: data.floor }
          : location
      )))
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to update the location mapping.'))
    } finally {
      setSavingLocationId(null)
    }
  }

  function selectCreateBuilding(event) {
    setBuildingKey(event.target.value)
    setFloor('')
  }

  const createBuilding = buildings.find((building) => building.key === buildingKey)

  function download(location) {
    const link = document.createElement('a')
    link.href = codes[location.id]
    link.download = `campusfix-location-${location.id}.png`
    link.click()
  }

  return (
    <WorkspaceLayout title="Location QR codes">
      <form className="workspace-panel workspace-form location-form" onSubmit={addLocation}>
        <div className="report-section__heading">
          <span className="report-section__number"><MapPinPlus size={15} aria-hidden="true" /></span>
          <div><h2>Create a location or asset</h2><p>Generate a QR code that links directly to the issue report.</p></div>
        </div>
        <label className="form-field">
          <span>Name</span>
          <input maxLength="150" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Room 204 Projector" />
        </label>
        <label className="form-field">
          <span>Details (optional)</span>
          <textarea maxLength="1000" value={details} onChange={(event) => setDetails(event.target.value)} />
        </label>
        <div className="location-mapping location-mapping--create">
          <label className="form-field">
            <span>Campus building (optional)</span>
            <select value={buildingKey} onChange={selectCreateBuilding}>
              <option value="">Map later</option>
              {buildings.map((building) => <option key={building.key} value={building.key}>{building.name}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Floor (optional)</span>
            <select value={floor} disabled={!createBuilding} onChange={(event) => setFloor(event.target.value)}>
              <option value="">Not specified</option>
              {createBuilding?.floors.map((item) => <option key={item} value={item}>{item === 'Ground' ? 'Ground floor' : `Floor ${item}`}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={isSaving} type="submit">{isSaving ? 'Creating…' : 'Add location'}</button>
      </form>
      <div className="qr-grid">
        {isLoading && <p className="workspace-empty">Loading campus locations…</p>}
        {locations.map((location) => (
          <article className="workspace-panel qr-card" key={location.id}>
            <div className="qr-card__body">
              <div>
                <h2>{location.name}</h2>
                {location.details && <p>{location.details}</p>}
                <p className="eyebrow">Location #{location.id}</p>
              </div>
              {codes[location.id] && <img src={codes[location.id]} alt={`Report QR code for ${location.name}`} />}
            </div>
            <LocationMapping
              key={`${location.id}-${location.building_key || ''}-${location.floor || ''}`}
              location={location}
              buildings={buildings}
              isSaving={savingLocationId === location.id}
              onSave={saveMapping}
            />
            <div className="qr-actions">
              <button className="button button--secondary" disabled={!codes[location.id]} type="button" onClick={() => download(location)}>Download PNG</button>
              <button className="button button--secondary" type="button" onClick={() => window.print()}>Print</button>
            </div>
          </article>
        ))}
      </div>
      {!isLoading && locations.length === 0 && !error && <p className="workspace-empty">No campus locations have been added yet.</p>}
    </WorkspaceLayout>
  )
}

export default QrCodesPage
