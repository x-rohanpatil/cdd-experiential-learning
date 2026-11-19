import { useEffect, useState } from 'react'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { EmptyIllustration, SkeletonLoader } from '../components/StateViews.jsx'
import { ComplaintCard } from '../components/ComplaintCard.jsx'
import ComplaintFilters from '../components/ComplaintFilters.jsx'
import { Link } from 'react-router-dom'
import { filterComplaints } from '../utils/complaints.js'
import {
  assignComplaint,
  createStaffAccount,
  getAdminComplaints,
  getAdminLocations,
  getApiErrorMessage,
  getStaff,
} from '../services/api.js'

const OPEN_STATUSES = new Set(['Reported', 'Submitted', 'Assigned', 'In Progress'])
const COMPLETED_STATUSES = new Set(['Resolved', 'Closed'])

function timestamp(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatResolutionTime(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 24) return `${Math.round(hours)} hr`
  return `${(hours / 24).toFixed(1)} days`
}

function AdminPage() {
  const [complaints, setComplaints] = useState([])
  const [staff, setStaff] = useState([])
  const [departments, setDepartments] = useState([])
  const [assignments, setAssignments] = useState({})
  const [staffForm, setStaffForm] = useState({
    name: '',
    employee_id: '',
    department: '',
    phone: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingStaff, setIsSavingStaff] = useState(false)
  const [busyComplaint, setBusyComplaint] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  async function refresh() {
    const [complaintResponse, staffResponse, locationResponse] = await Promise.all([
      getAdminComplaints(),
      getStaff(),
      getAdminLocations(),
    ])
    setComplaints(complaintResponse.data.complaints)
    setStaff(staffResponse.data.staff)
    setDepartments(locationResponse.data.locations)
    setLoadedAt(Date.now())
  }

  useEffect(() => {
    Promise.resolve()
      .then(refresh)
      .catch((requestError) => setError(getApiErrorMessage(requestError, 'Unable to load admin data.')))
      .finally(() => setIsLoading(false))
  }, [])

  async function assign(complaintId) {
    const staffId = Number(assignments[complaintId])
    if (!staffId) return
    setError('')
    setSuccess('')
    setBusyComplaint(complaintId)
    try {
      await assignComplaint(complaintId, staffId)
      await refresh()
      setSuccess(`Complaint #${complaintId} was assigned.`)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to assign complaint.'))
    } finally {
      setBusyComplaint(null)
    }
  }

  async function addStaff(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setIsSavingStaff(true)
    try {
      await createStaffAccount(staffForm)
      setStaffForm({ name: '', employee_id: '', department: '', phone: '', password: '' })
      await refresh()
      setSuccess('The maintenance staff account was created.')
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to create staff account.'))
    } finally {
      setIsSavingStaff(false)
    }
  }

  const filtered = filterComplaints(complaints, search, status)
  const activeCount = complaints.filter((item) => OPEN_STATUSES.has(item.status)).length
  const overdueCount = complaints.filter((item) => {
    const dueAt = timestamp(item.due_at)
    return OPEN_STATUSES.has(item.status) && dueAt !== null && loadedAt !== null && dueAt < loadedAt
  }).length
  const resolvedWithDuration = complaints
    .filter((item) => COMPLETED_STATUSES.has(item.status))
    .map((item) => {
      const createdAt = timestamp(item.created_at)
      const resolvedAt = timestamp(item.resolved_at)
      return createdAt !== null && resolvedAt !== null && resolvedAt >= createdAt
        ? (resolvedAt - createdAt) / 3_600_000
        : null
    })
    .filter((hours) => hours !== null)
  const averageResolutionHours = resolvedWithDuration.length
    ? resolvedWithDuration.reduce((total, hours) => total + hours, 0) / resolvedWithDuration.length
    : null
  const resolvedWithSla = complaints.filter((item) => {
    return COMPLETED_STATUSES.has(item.status)
      && timestamp(item.resolved_at) !== null
      && timestamp(item.due_at) !== null
  })
  const resolvedWithinSla = resolvedWithSla.filter((item) => {
    return timestamp(item.resolved_at) <= timestamp(item.due_at)
  }).length
  const onTimePercentage = resolvedWithSla.length
    ? Math.round((resolvedWithinSla / resolvedWithSla.length) * 100)
    : null

  return (
    <WorkspaceLayout title="Complaint administration">
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      {success && <p className="form-message form-message--success" role="status">{success}</p>}
      <section className="workspace-summary">
        <div className="workspace-summary__card"><span className="eyebrow">ALL REQUESTS</span><strong>{isLoading || error ? '—' : complaints.length}</strong><span>Campus complaints</span></div>
        <div className="workspace-summary__card"><span className="eyebrow">NEEDS ATTENTION</span><strong>{isLoading || error ? '—' : activeCount}</strong><span>Open or in progress</span></div>
        <div className="workspace-summary__card"><span className="eyebrow">ESCALATED</span><strong>{isLoading || error ? '—' : complaints.filter((item) => item.escalation_level > 0).length}</strong><span>Past SLA threshold</span></div>
        <div className="workspace-summary__card"><span className="eyebrow">CAMPUS TEAM</span><strong>{isLoading || error ? '—' : staff.length}</strong><span>{isLoading || error ? '—' : `${departments.length} locations`}</span></div>
      </section>
      <section className="admin-sla-section" aria-labelledby="admin-sla-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SERVICE LEVELS</p>
            <h2 id="admin-sla-heading">How requests are moving</h2>
            <p className="admin-sla-intro">Live indicators based on reported deadlines and recorded repair times.</p>
          </div>
        </div>
        <div className="admin-sla-grid">
          <article className="admin-sla-card admin-sla-card--attention">
            <span className="eyebrow">PAST TARGET DATE</span>
            <strong>{isLoading || error ? '—' : overdueCount}</strong>
            <p>Open requests that need follow-up.</p>
          </article>
          <article className="admin-sla-card">
            <span className="eyebrow">AVERAGE REPAIR TIME</span>
            <strong>{isLoading || error || averageResolutionHours === null ? '—' : formatResolutionTime(averageResolutionHours)}</strong>
            <p>{isLoading ? 'Loading repair data…' : error ? 'Metrics are unavailable.' : averageResolutionHours === null ? 'No completed repair times yet.' : `Based on ${resolvedWithDuration.length} completed ${resolvedWithDuration.length === 1 ? 'request' : 'requests'}.`}</p>
          </article>
          <article className="admin-sla-card">
            <span className="eyebrow">MET TARGET DATE</span>
            <strong>{isLoading || error || onTimePercentage === null ? '—' : `${onTimePercentage}%`}</strong>
            <p>{isLoading ? 'Loading repair data…' : error ? 'Metrics are unavailable.' : onTimePercentage === null ? 'No completed requests with a target date yet.' : `${resolvedWithinSla} of ${resolvedWithSla.length} completed requests.`}</p>
          </article>
        </div>
      </section>
      <section className="admin-tools glass-card">
        <div className="section-heading">
          <div><p className="eyebrow">TEAM ACCESS</p><h2>Maintenance staff</h2></div>
          <span className="admin-tools__count">{isLoading || error ? '— accounts' : `${staff.length} accounts`}</span>
        </div>
        <form className="workspace-form staff-account-form" onSubmit={addStaff}>
          <p className="admin-form-intro">Create an account for a campus maintenance team member.</p>
        {[
          ['name', 'Full name', 'text'],
          ['employee_id', 'Employee ID', 'text'],
          ['department', 'Department', 'text'],
          ['phone', 'Phone (optional)', 'tel'],
          ['password', 'Temporary password (12+ characters)', 'password'],
        ].map(([field, label, type]) => (
          <label className="form-field" key={field}>
            <span>{label}</span>
            <input
              autoComplete={field === 'password' ? 'new-password' : 'off'}
              minLength={field === 'password' ? 12 : undefined}
              required={field !== 'phone'}
              type={type}
              value={staffForm[field]}
              onChange={(event) => setStaffForm((current) => ({
                ...current,
                [field]: event.target.value,
              }))}
            />
          </label>
        ))}
          <button className="button button--primary" disabled={isSavingStaff} type="submit">{isSavingStaff ? 'Creating account…' : 'Create staff account'}</button>
        </form>
      </section>
      <section className="admin-complaints-section">
        <div className="section-heading">
          <div><p className="eyebrow">CAMPUS OPERATIONS</p><h2>All complaints</h2></div>
          <Link className="text-link" to="/admin/qr-codes">Manage locations</Link>
        </div>
        <ComplaintFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} />
        {isLoading && <SkeletonLoader rows={4} large label="Loading campus complaints" />}
        {complaints.length > 0 && filtered.length === 0 && <p className="workspace-empty">No complaints match those filters.</p>}
        <div className="complaint-list">
        {filtered.map((complaint) => (
          <ComplaintCard key={complaint.id} complaint={complaint}>
            <div className="admin-complaint-actions">
              <span className="admin-escalation">Escalation level <strong>{complaint.escalation_level}</strong></span>
              <label className="form-field">
                <span>Assign to staff</span>
                <select
                  value={assignments[complaint.id] ?? complaint.staff_id ?? ''}
                  onChange={(event) => setAssignments((current) => ({
                    ...current,
                    [complaint.id]: event.target.value,
                  }))}
                >
                  <option value="">Select staff member</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} — {person.department}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button button--secondary" disabled={busyComplaint === complaint.id} type="button" onClick={() => assign(complaint.id)}>{busyComplaint === complaint.id ? 'Assigning…' : 'Assign to staff'}</button>
            </div>
          </ComplaintCard>
        ))}
        </div>
        {!isLoading && complaints.length === 0 && !error && <div className="empty-state"><EmptyIllustration variant="request" /><h2>No complaints to review</h2><p>New campus reports will appear here for assignment.</p></div>}
      </section>
    </WorkspaceLayout>
  )
}

export default AdminPage
