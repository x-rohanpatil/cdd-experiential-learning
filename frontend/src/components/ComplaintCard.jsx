import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, MapPin } from './Icons.jsx'
import { Link } from 'react-router-dom'
import { getComplaintPhoto } from '../services/api.js'

let clockTimestamp = new Date().getTime()
let clockTimer
const clockListeners = new Set()

function subscribeToClock(listener) {
  clockListeners.add(listener)
  if (!clockTimer) {
    clockTimer = window.setInterval(() => {
      clockTimestamp = new Date().getTime()
      clockListeners.forEach((notify) => notify())
    }, 60_000)
  }
  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size === 0) {
      window.clearInterval(clockTimer)
      clockTimer = undefined
    }
  }
}

function getClockSnapshot() {
  return clockTimestamp
}

export function SlaBadge({ dueAt, createdAt, status }) {
  const now = useSyncExternalStore(subscribeToClock, getClockSnapshot, getClockSnapshot)
  if (status === 'Resolved' || status === 'Closed') {
    return <span className={`status-badge status-badge--${status.toLowerCase()}`}>{status}</span>
  }
  if (!dueAt) return <span className="status-badge">SLA unavailable</span>
  const dueTimestamp = new Date(dueAt).getTime()
  if (!Number.isFinite(dueTimestamp)) return <span className="status-badge">SLA unavailable</span>
  const remaining = dueTimestamp - now
  if (remaining <= 0) return <span className="status-badge status-badge--overdue sla-badge">Overdue</span>
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const parsedStart = createdAt ? new Date(createdAt).getTime() : now
  const startTimestamp = Number.isFinite(parsedStart) ? parsedStart : now
  const total = Math.max(1, dueTimestamp - startTimestamp)
  const elapsed = Math.min(total, Math.max(0, now - startTimestamp))
  const progress = Math.min(100, Math.max(0, (elapsed / total) * 100))
  return (
    <span className="status-badge sla-badge" aria-label={`${hours} hours and ${minutes} minutes until target`}>
      <span>{hours}h {minutes}m left</span>
      <span className="sla-badge__meter" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
    </span>
  )
}

export function PrivatePhoto({ filename, label }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!filename) return undefined
    let active = true
    let objectUrl = ''
    getComplaintPhoto(filename)
      .then(({ data }) => {
        if (!active) return
        objectUrl = URL.createObjectURL(data)
        setUrl(objectUrl)
      })
      .catch(() => setFailed(true))
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filename])

  if (!filename) return null
  return (
    <figure className="complaint-photo">
      {url
        ? <img src={url} alt={label} />
        : <span className={failed ? 'photo-placeholder' : 'photo-placeholder photo-placeholder--loading'}>{failed ? 'Photo unavailable' : 'Loading photo…'}</span>}
      <figcaption>{label}</figcaption>
    </figure>
  )
}

export function ComplaintCard({ complaint, children }) {
  return (
    <article className="complaint-card">
      <div className="complaint-card__header">
        <div>
          <p className="eyebrow">Complaint #{complaint.id}</p>
          <h2><Link className="complaint-card__title" to={`/complaints/${complaint.id}`}>{complaint.title}</Link></h2>
        </div>
        <SlaBadge createdAt={complaint.created_at} dueAt={complaint.due_at} status={complaint.status} />
      </div>
      <p>{complaint.summary || complaint.description}</p>
      <div className="complaint-meta">
        <span>{complaint.category}</span>
        <span className={`priority priority--${complaint.priority}`}>{complaint.priority}</span>
        {!['Resolved', 'Closed'].includes(complaint.status) && (
          <span className={`status-badge status-badge--${complaint.status.toLowerCase().replaceAll(' ', '-')}`}>{complaint.status}</span>
        )}
        <span className="complaint-meta__location"><MapPin size={14} aria-hidden="true" />{complaint.location}</span>
      </div>
      <div className="complaint-photos">
        <PrivatePhoto filename={complaint.before_photo_path} label="Before" />
        <PrivatePhoto filename={complaint.after_photo_path} label="After" />
      </div>
      {complaint.resolution_note && <p className="resolution-note">{complaint.resolution_note}</p>}
      {children}
      <Link className="complaint-card__details" to={`/complaints/${complaint.id}`}>
        View complaint <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </article>
  )
}

export default ComplaintCard
