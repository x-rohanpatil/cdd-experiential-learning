import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ClipboardList, Clock3, CircleCheck, CircleDashed } from '../components/Icons.jsx'
import { Link } from 'react-router-dom'
import ComplaintCard from '../components/ComplaintCard.jsx'
import ComplaintFilters from '../components/ComplaintFilters.jsx'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { EmptyIllustration, SkeletonLoader } from '../components/StateViews.jsx'
import { getApiErrorMessage, getStudentComplaints } from '../services/api.js'
import { filterComplaints } from '../utils/complaints.js'

function DashboardPage() {
  const auth = JSON.parse(sessionStorage.getItem('campusfix.auth') ?? '{}')
  const [complaints, setComplaints] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  useEffect(() => {
    let active = true
    getStudentComplaints(auth.id)
      .then(({ data }) => {
        if (active) setComplaints(data.complaints)
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Unable to load your dashboard.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [auth.id])

  const stats = useMemo(() => [
    { label: 'Total requests', value: complaints.length, icon: ClipboardList, tone: 'blue' },
    { label: 'Awaiting action', value: complaints.filter((item) => ['Reported', 'Submitted', 'Assigned'].includes(item.status)).length, icon: CircleDashed, tone: 'amber' },
    { label: 'In progress', value: complaints.filter((item) => item.status === 'In Progress').length, icon: Clock3, tone: 'violet' },
    { label: 'Resolved', value: complaints.filter((item) => ['Resolved', 'Closed'].includes(item.status)).length, icon: CircleCheck, tone: 'green' },
  ], [complaints])

  const filtered = filterComplaints(complaints, search, status)
  const recent = filtered.slice(0, 3)
  const statuses = ['Reported', 'Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed']

  return (
    <WorkspaceLayout title="Your campus, taken care of">
      <section className="dashboard-welcome">
        <div>
          <p className="eyebrow eyebrow--blue">STUDENT OVERVIEW</p>
          <h2>Welcome back, {auth.name?.split(' ')[0] || 'there'}.</h2>
          <p>Here’s the latest on the issues you’ve reported.</p>
        </div>
        <Link className="button button--primary" to="/report">
          <span className="button__plus" aria-hidden="true">+</span> Report an issue
        </Link>
      </section>

      {error && <p className="form-message form-message--error" role="alert">{error}</p>}

      <section className="dashboard-stats" aria-label="Complaint summary">
        {stats.map(({ label, value, icon: Icon, tone }, index) => (
          <article className={`dashboard-stat dashboard-stat--${tone}`} key={label}>
            <span className="dashboard-stat__icon"><Icon size={19} aria-hidden="true" /></span>
            <span className="dashboard-stat__label">{label}</span>
            <strong className="dashboard-stat__value" style={{ animationDelay: `${index * 70}ms` }}>
              {isLoading || error ? '—' : value}
            </strong>
          </article>
        ))}
      </section>

      <section className="dashboard-lower">
        <div className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR REQUESTS</p>
              <h2>Recent complaints</h2>
            </div>
            <Link className="text-link" to="/tracking">View all <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
          <ComplaintFilters
            search={search}
            onSearchChange={setSearch}
            status={status}
            onStatusChange={setStatus}
          />
          {isLoading && <SkeletonLoader rows={2} large label="Loading your recent complaints" />}
          {!isLoading && !error && complaints.length === 0 && (
            <div className="empty-state glass-card">
              <EmptyIllustration variant="request" />
              <span className="empty-state__icon"><ClipboardList size={23} aria-hidden="true" /></span>
              <h3>A good place to start</h3>
              <p>You haven’t reported an issue yet. Your first report helps keep campus in shape.</p>
              <Link className="text-link" to="/report">Report an issue <ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
          )}
          {!isLoading && complaints.length > 0 && recent.length === 0 && (
            <p className="workspace-empty">No complaints match those filters.</p>
          )}
          <div className="complaint-list">
            {recent.map((complaint) => (
              <ComplaintCard key={complaint.id} complaint={complaint} />
            ))}
          </div>
        </div>

        <aside className="dashboard-section dashboard-progress">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AT A GLANCE</p>
              <h2>Request status</h2>
            </div>
          </div>
          {isLoading && <SkeletonLoader rows={4} label="Loading status breakdown" />}
          {error && <p className="form-message form-message--error" role="status">Status breakdown is unavailable until your requests load.</p>}
          {!isLoading && !error && (
            <>
              <div className="status-chart" aria-label="Complaint counts by status">
                {statuses.map((item) => {
                  const count = complaints.filter((complaint) => complaint.status === item).length
                  const width = complaints.length ? (count / complaints.length) * 100 : 0
                  return (
                    <div className="status-chart__row" key={item}>
                      <div className="status-chart__label"><span>{item}</span><strong>{count}</strong></div>
                      <span className="status-chart__track"><span style={{ width: `${width}%` }} /></span>
                    </div>
                  )
                })}
              </div>
              <p className="dashboard-progress__note">
                <CircleCheck size={15} aria-hidden="true" />
                Your updates are based on the latest campus records.
              </p>
              <section className="dashboard-activity" aria-labelledby="dashboard-activity-heading">
                <div className="dashboard-activity__heading"><p className="eyebrow">LATEST MOVEMENT</p><h3 id="dashboard-activity-heading">Recent activity</h3></div>
                {complaints.length > 0 ? (
                  <ol className="dashboard-activity__list">
                    {complaints.slice(0, 3).map((item) => (
                      <li key={item.id}>
                        <span className="dashboard-activity__marker" aria-hidden="true" />
                        <div><strong>{item.title}</strong><small>Request #{item.id} · {new Date(item.updated_at || item.created_at).toLocaleDateString()}</small></div>
                        <span className={`status-badge status-badge--${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="dashboard-progress__note">Your first update will appear here after you report an issue.</p>}
              </section>
            </>
          )}
        </aside>
      </section>
    </WorkspaceLayout>
  )
}

export default DashboardPage
