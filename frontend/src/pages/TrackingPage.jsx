import { useEffect, useState } from 'react'
import { ClipboardList } from '../components/Icons.jsx'
import { Link } from 'react-router-dom'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { ComplaintCard } from '../components/ComplaintCard.jsx'
import ComplaintFilters from '../components/ComplaintFilters.jsx'
import { getApiErrorMessage, getStudentComplaints, verifyComplaint } from '../services/api.js'
import { filterComplaints } from '../utils/complaints.js'
import { EmptyIllustration, SkeletonLoader } from '../components/StateViews.jsx'

function TrackingPage() {
  const auth = JSON.parse(sessionStorage.getItem('campusfix.auth') ?? '{}')
  const [complaints, setComplaints] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [busyComplaint, setBusyComplaint] = useState(null)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true
    getStudentComplaints(auth.id)
      .then(({ data }) => {
        if (active) setComplaints(data.complaints)
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Unable to load complaints.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [auth.id])

  async function verify(complaintId, action) {
    setError('')
    setSuccess('')
    setBusyComplaint(complaintId)
    try {
      await verifyComplaint(auth.id, complaintId, action)
      const { data } = await getStudentComplaints(auth.id)
      setComplaints(data.complaints)
      setSuccess(action === 'confirm' ? 'Thanks for confirming the repair.' : 'The issue has been reopened for follow-up.')
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to update verification.'))
    } finally {
      setBusyComplaint(null)
    }
  }

  const filtered = filterComplaints(complaints, search, status)

  return (
    <WorkspaceLayout title="My complaints">
      <div className="tracking-intro">
        <p>Every request, in one place. Select a complaint to see the full details.</p>
        <Link className="button button--primary" to="/report">+ Report an issue</Link>
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      {success && <p className="form-message form-message--success" role="status">{success}</p>}
      <ComplaintFilters
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
      />
      {isLoading && <SkeletonLoader rows={3} large label="Loading your complaints" />}
      {!isLoading && complaints.length === 0 && !error && (
        <div className="empty-state glass-card">
          <EmptyIllustration variant="request" />
          <span className="empty-state__icon"><ClipboardList size={23} aria-hidden="true" /></span>
          <h2>No complaints yet</h2>
          <p>When you report a campus issue, you’ll be able to follow its progress here.</p>
          <Link className="text-link" to="/report">Report an issue</Link>
        </div>
      )}
      {!isLoading && complaints.length > 0 && filtered.length === 0 && (
        <p className="workspace-empty">No complaints match those filters.</p>
      )}
      <div className="complaint-list">
        {filtered.map((complaint) => (
          <ComplaintCard key={complaint.id} complaint={complaint}>
            {complaint.status === 'Resolved' && (
              <div className="verification-actions">
                <p>Is it fixed? Confirm to close, or reopen if the issue remains.</p>
                <Link className="button button--secondary" to={`/complaints/${complaint.id}`}>Review resolution</Link>
                <button className="button button--primary" disabled={busyComplaint === complaint.id} type="button" onClick={() => verify(complaint.id, 'confirm')}>{busyComplaint === complaint.id ? 'Updating…' : 'Confirm fixed'}</button>
                <button className="button button--secondary" disabled={busyComplaint === complaint.id} type="button" onClick={() => verify(complaint.id, 'reopen')}>Reopen</button>
              </div>
            )}
          </ComplaintCard>
        ))}
      </div>
    </WorkspaceLayout>
  )
}

export default TrackingPage
