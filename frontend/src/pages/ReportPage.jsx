import { useEffect, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import ImageUploadField from '../components/ImageUploadField.jsx'
import {
  analyzeComplaint,
  createComplaint,
  createComplaintWithPhoto,
  getApiErrorMessage,
  getLocations,
} from '../services/api.js'

const categories = ['Electrical', 'Plumbing', 'Furniture', 'Network', 'AV Equipment', 'Washroom', 'Other']
const priorities = ['low', 'medium', 'high', 'critical']

function ReportPage() {
  const auth = JSON.parse(sessionStorage.getItem('campusfix.auth') ?? '{}')
  const [searchParams] = useSearchParams()
  const [locations, setLocations] = useState([])
  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    category: 'Other',
    priority: 'medium',
    suggested_team: '',
    summary: '',
  })
  const [photo, setPhoto] = useState(null)
  const [suggested, setSuggested] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [locationError, setLocationError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isLoadingLocations, setIsLoadingLocations] = useState(true)

  useEffect(() => {
    getLocations()
      .then(({ data }) => {
        setLocations(data)
        const selected = data.find((location) => String(location.id) === searchParams.get('location'))
        if (selected) setForm((current) => ({ ...current, location: selected.name }))
      })
      .catch((requestError) => {
        setLocations([])
        setLocationError(getApiErrorMessage(requestError, 'Campus locations are temporarily unavailable.'))
      })
      .finally(() => setIsLoadingLocations(false))
  }, [searchParams])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    if (name === 'title' || name === 'description') setSuggested(false)
  }

  async function requestSuggestion() {
    setError('')
    setBusy(true)
    try {
      const { data } = await analyzeComplaint(form.title, form.description, photo)
      setForm((current) => ({ ...current, ...data }))
      setSuggested(true)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to analyze this complaint.'))
    } finally {
      setBusy(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      let complaint = form
      if (!suggested) {
        const { data } = await analyzeComplaint(form.title, form.description, photo)
        complaint = { ...form, ...data }
        setForm(complaint)
        setSuggested(true)
      }
      if (photo) {
        await createComplaintWithPhoto(auth.id, complaint, photo)
      } else {
        await createComplaint(auth.id, complaint)
      }
      setMessage('Your complaint has been submitted.')
      setForm({
        title: '',
        description: '',
        location: '',
        category: 'Other',
        priority: 'medium',
        suggested_team: '',
        summary: '',
      })
      setPhoto(null)
      setSuggested(false)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to submit your complaint.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WorkspaceLayout title="Report a maintenance issue">
      <div className="report-intro">
        <p>Tell us what needs attention. Your campus team will take it from here.</p>
        <div className="report-steps" aria-label="Report process">
          <span className="report-step report-step--active"><b>01</b> Describe</span>
          <span className="report-step"><b>02</b> Review</span>
          <span className="report-step"><b>03</b> Submit</span>
        </div>
      </div>
      <form className="workspace-panel workspace-form report-form" onSubmit={submit}>
        <section className="report-section">
          <div className="report-section__heading">
            <span className="report-section__number">01</span>
            <div><h2>Tell us what happened</h2><p>A clear description helps us route your request.</p></div>
          </div>
          <label className="form-field">
            <span>Issue title</span>
            <input name="title" maxLength="200" required value={form.title} onChange={updateField} placeholder="e.g. Projector in Room 204 is not turning on" />
          </label>
          <label className="form-field">
            <span>Description</span>
            <textarea name="description" maxLength="10000" required value={form.description} onChange={updateField} placeholder="Share what you noticed and when it started…" />
          </label>
        </section>

        <section className="report-section">
          <div className="report-section__heading">
            <span className="report-section__number">02</span>
            <div><h2>Where is the issue?</h2><p>Choose a location or describe where we can find it.</p></div>
          </div>
          <label className="form-field">
            <span>Campus location</span>
            {isLoadingLocations ? (
              <select aria-label="Campus location" disabled value="">
                <option value="">Loading campus locations…</option>
              </select>
            ) : locations.length > 0 ? (
              <select name="location" required value={form.location} onChange={updateField}>
                <option value="">Select a campus location</option>
                {locations.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            ) : (
              <input name="location" required value={form.location} onChange={updateField} placeholder="Building, floor, and room" />
            )}
          </label>
          {locationError && <p className="form-message form-message--error" role="status">{locationError} You can enter the location manually.</p>}
          <ImageUploadField
            id="report-issue-photo"
            label="Photo of the issue (optional)"
            value={photo}
            onChange={(file) => {
              setPhoto(file)
              setSuggested(false)
            }}
          />
        </section>

        <section className="report-section report-section--suggestions">
          <button className="button button--secondary" disabled={busy || !form.title || !form.description} type="button" onClick={requestSuggestion}>
            <Sparkles size={16} aria-hidden="true" /> {busy ? 'Reviewing your report…' : 'Suggest category and priority'}
          </button>
          {suggested && (
            <section className="suggestion-panel" aria-label="AI suggestions">
              <div className="suggestion-panel__heading">
                <Sparkles size={17} aria-hidden="true" />
                <div><strong>Suggested details</strong><p>Review and adjust these before you submit.</p></div>
              </div>
            <label className="form-field">
              <span>Category</span>
              <select name="category" value={form.category} onChange={updateField}>
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Priority</span>
              <select name="priority" value={form.priority} onChange={updateField}>
                {priorities.map((priority) => <option key={priority}>{priority}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Suggested team</span>
              <input name="suggested_team" value={form.suggested_team} onChange={updateField} />
            </label>
            <label className="form-field">
              <span>Summary</span>
              <textarea name="summary" value={form.summary} onChange={updateField} />
            </label>
            </section>
          )}
        </section>
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        {message && <p className="form-message form-message--success" role="status">{message}</p>}
        <div className="report-submit">
          <p><Check size={15} aria-hidden="true" /> Your report is only shared with your campus team.</p>
          <button className="button button--primary" disabled={busy || isLoadingLocations} type="submit">{busy ? 'Submitting…' : 'Submit report'}</button>
        </div>
      </form>
    </WorkspaceLayout>
  )
}

export default ReportPage
