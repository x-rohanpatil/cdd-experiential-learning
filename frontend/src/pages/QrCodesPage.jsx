import { useEffect, useState } from 'react'
import { MapPinPlus } from 'lucide-react'
import QRCode from 'qrcode'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import {
  createLocation,
  getAdminLocations,
  getApiErrorMessage,
} from '../services/api.js'

function QrCodesPage() {
  const [locations, setLocations] = useState([])
  const [codes, setCodes] = useState({})
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  async function loadLocations() {
    const { data } = await getAdminLocations()
    setLocations(data.locations)
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
      await createLocation({ name, details: details || null })
      setName('')
      setDetails('')
      await loadLocations()
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to create location.'))
    } finally {
      setIsSaving(false)
    }
  }

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
