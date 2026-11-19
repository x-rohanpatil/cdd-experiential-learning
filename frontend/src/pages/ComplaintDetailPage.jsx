import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarDays, MapPin, Star, Tag } from '../components/Icons.jsx'
import { Link, useParams } from 'react-router-dom'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { ComplaintCard } from '../components/ComplaintCard.jsx'
import { SkeletonLoader } from '../components/StateViews.jsx'
import {
  getAdminComplaints,
  getApiErrorMessage,
  getComplaintActivity,
  getComplaintFeedback,
  getStaffTasks,
  getStudentComplaints,
  submitComplaintFeedback,
  verifyComplaint,
} from '../services/api.js'

const ACTOR_LABELS = {
  student: 'You',
  staff: 'Maintenance staff',
  admin: 'Campus admin',
  system: 'CampusFix',
}

function relativeTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  const difference = (date.getTime() - Date.now()) / 1000
  if (Math.abs(difference) < 60) return 'Just now'
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const [unit, seconds] = units.find(([, size]) => Math.abs(difference) >= size)
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    .format(Math.round(difference / seconds), unit)
}

async function fetchComplaintData(auth, complaintId) {
  let response
  if (auth.role === 'admin') {
    response = await getAdminComplaints()
  } else if (auth.role === 'staff') {
    response = await getStaffTasks(auth.id)
  } else {
    response = await getStudentComplaints(auth.id)
  }
  const records = response.data.complaints ?? response.data.tasks ?? []
  const complaint = records.find((item) => String(item.id) === complaintId) ?? null
  if (!complaint) {
    return {
      complaint: null,
      activity: [],
      activityError: '',
      feedbackStatus: null,
      feedbackError: '',
    }
  }

  try {
    const activityResponse = await getComplaintActivity(complaint.id)
    let feedbackStatus = null
    let feedbackError = ''
    if (complaint.status === 'Closed' && ['student', 'admin'].includes(auth.role)) {
      try {
        const feedbackResponse = await getComplaintFeedback(complaint.id)
        feedbackStatus = feedbackResponse.data
      } catch (requestError) {
        feedbackError = getApiErrorMessage(requestError, 'Unable to load repair feedback.')
      }
    }
    return {
      complaint,
      activity: activityResponse.data,
      activityError: '',
      feedbackStatus,
      feedbackError,
    }
  } catch (requestError) {
    return {
      complaint,
      activity: [],
      activityError: getApiErrorMessage(requestError, 'Unable to load request updates.'),
      feedbackStatus: null,
      feedbackError: '',
    }
  }
}

function ComplaintDetailPage() {
  const auth = JSON.parse(sessionStorage.getItem('campusfix.auth') ?? '{}')
  const authId = auth.id
  const authRole = auth.role
  const { complaintId } = useParams()
  const [complaint, setComplaint] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityError, setActivityError] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState(null)
  const [feedbackError, setFeedbackError] = useState('')
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false)
  const [isActivityLoading, setIsActivityLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await fetchComplaintData({ id: authId, role: authRole }, complaintId)
        if (!active) return
        setComplaint(result.complaint)
        setActivity(result.activity)
        setActivityError(result.activityError)
        setFeedbackStatus(result.feedbackStatus)
        setFeedbackError(result.feedbackError)
        setIsActivityLoading(false)
      } catch (requestError) {
        if (active) setError(getApiErrorMessage(requestError, 'Unable to load this complaint.'))
      } finally {
        if (active) setIsLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [authId, authRole, complaintId])

  async function verify(action) {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await verifyComplaint(authId, complaint.id, action)
      const result = await fetchComplaintData({ id: authId, role: authRole }, complaintId)
      setComplaint(result.complaint)
      setActivity(result.activity)
      setActivityError(result.activityError)
      setFeedbackStatus(result.feedbackStatus)
      setFeedbackError(result.feedbackError)
      setMessage(action === 'confirm' ? 'Thanks for confirming the repair.' : 'The issue has been reopened for follow-up.')
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to update this complaint.'))
    } finally {
      setBusy(false)
    }
  }

  async function submitFeedback(event) {
    event.preventDefault()
    if (!feedbackRating) {
      setFeedbackError('Choose a star rating before submitting.')
      return
    }
    setFeedbackError('')
    setIsSubmittingFeedback(true)
    try {
      await submitComplaintFeedback(complaint.id, {
        rating: feedbackRating,
        comment: feedbackComment,
      })
      const result = await fetchComplaintData({ id: authId, role: authRole }, complaintId)
      setComplaint(result.complaint)
      setActivity(result.activity)
      setActivityError(result.activityError)
      setFeedbackStatus(result.feedbackStatus)
      setFeedbackError(result.feedbackError)
    } catch (requestError) {
      setFeedbackError(getApiErrorMessage(requestError, 'Unable to submit your feedback.'))
    } finally {
      setIsSubmittingFeedback(false)
    }
  }

  const backPath = authRole === 'admin' ? '/admin' : authRole === 'staff' ? '/staff/tasks' : '/tracking'
  const existingFeedback = feedbackStatus?.feedback
  const showFeedback = complaint?.status === 'Closed' && (
    (authRole === 'student' && (feedbackStatus?.eligible || existingFeedback || feedbackError))
    || authRole === 'admin'
  )

  return (
    <WorkspaceLayout title="Complaint details">
      <Link className="back-link" to={backPath}><ArrowLeft size={16} aria-hidden="true" /> Back to complaints</Link>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      {isLoading && <SkeletonLoader rows={2} large label="Loading complaint details" />}
      {!isLoading && !error && !complaint && <p className="workspace-empty">This complaint isn’t available in your workspace.</p>}
      {complaint && (
        <div className="complaint-detail-layout">
          <div className="complaint-detail-main">
            <ComplaintCard complaint={complaint} />
            <section className="activity-panel glass-card" aria-labelledby="activity-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">REQUEST PROGRESS</p>
                  <h2 id="activity-heading">Updates to your request</h2>
                </div>
              </div>
              {isActivityLoading && <SkeletonLoader rows={3} label="Loading request updates" />}
              {activityError && <p className="form-message form-message--error" role="alert">{activityError}</p>}
              {!isActivityLoading && !activityError && activity.length === 0 && (
                <p className="workspace-empty">Updates will appear here as your request moves forward.</p>
              )}
              {activity.length > 0 && (
                <ol className="activity-timeline">
                  {activity.map((item) => (
                    <li className="activity-timeline__item" key={item.id}>
                      <span className="activity-timeline__marker" aria-hidden="true" />
                      <div className="activity-timeline__content">
                        <div className="activity-timeline__heading">
                          <h3>{item.message}</h3>
                          {item.to_status && (
                            <span className={`status-badge status-badge--${item.to_status.toLowerCase().replaceAll(' ', '-')}`}>
                              {item.to_status}
                            </span>
                          )}
                        </div>
                        <p>
                          {ACTOR_LABELS[item.actor_role] ?? 'Campus team'}
                          {' · '}
                          <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>
                            {relativeTime(item.created_at)}
                          </time>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {complaint.status === 'Resolved' && authRole === 'student' && (
              <section className="workspace-panel verification-panel">
                <p className="eyebrow">YOUR CONFIRMATION</p>
                <h2>Is everything working again?</h2>
                <p>Confirm the repair to close this request, or reopen it so the team can take another look.</p>
                {message && <p className="form-message form-message--success" role="status">{message}</p>}
                <div className="verification-actions">
                  <button className="button button--primary" disabled={busy} type="button" onClick={() => verify('confirm')}>
                    {busy ? 'Updating…' : 'Yes, it’s fixed'}
                  </button>
                  <button className="button button--secondary" disabled={busy} type="button" onClick={() => verify('reopen')}>
                    Reopen request
                  </button>
                </div>
              </section>
            )}
            {showFeedback && (
              <section className="feedback-panel glass-card" aria-labelledby="feedback-heading">
                <p className="eyebrow">{authRole === 'admin' ? 'STUDENT FEEDBACK' : 'HELP US IMPROVE'}</p>
                <h2 id="feedback-heading">
                  {authRole === 'admin' ? 'Repair experience' : 'How was your repair experience?'}
                </h2>
                {feedbackError && <p className="form-message form-message--error" role="alert">{feedbackError}</p>}
                {existingFeedback ? (
                  <div className="feedback-submitted">
                    <div className="feedback-rating-display" aria-label={`${existingFeedback.rating} out of 5 stars`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          size={18}
                          aria-hidden="true"
                          fill={index < existingFeedback.rating ? 'currentColor' : 'none'}
                        />
                      ))}
                      <span>{existingFeedback.rating} out of 5</span>
                    </div>
                    {existingFeedback.comment && <p className="feedback-comment">{existingFeedback.comment}</p>}
                    <p className="feedback-submitted__date">
                      Shared {new Date(existingFeedback.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ) : authRole === 'student' && feedbackStatus?.eligible ? (
                  <form className="feedback-form" onSubmit={submitFeedback}>
                    <p>Your rating helps the campus team improve. A comment is optional.</p>
                    <div className="feedback-rating" role="group" aria-label="Rate your repair experience">
                      {Array.from({ length: 5 }, (_, index) => {
                        const rating = index + 1
                        return (
                          <button
                            key={rating}
                            aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                            aria-pressed={feedbackRating === rating}
                            className={`feedback-rating__button${feedbackRating >= rating ? ' is-selected' : ''}`}
                            disabled={isSubmittingFeedback}
                            type="button"
                            onClick={() => setFeedbackRating(rating)}
                          >
                            <Star size={25} fill={feedbackRating >= rating ? 'currentColor' : 'none'} aria-hidden="true" />
                          </button>
                        )
                      })}
                    </div>
                    <label className="form-field">
                      <span>Anything you’d like us to know? <span className="feedback-optional">(optional)</span></span>
                      <textarea
                        maxLength={1000}
                        placeholder="Share a little about how the repair went"
                        value={feedbackComment}
                        onChange={(event) => setFeedbackComment(event.target.value)}
                      />
                    </label>
                    <div className="feedback-form__footer">
                      <span>{feedbackComment.length}/1000</span>
                      <button className="button button--primary" disabled={isSubmittingFeedback} type="submit">
                        {isSubmittingFeedback ? 'Sending…' : 'Send feedback'}
                      </button>
                    </div>
                  </form>
                ) : authRole === 'admin' ? (
                  <p className="workspace-empty">The student hasn’t shared feedback for this request.</p>
                ) : null}
              </section>
            )}
          </div>
          <aside className="complaint-detail-aside glass-card">
            <p className="eyebrow">REQUEST OVERVIEW</p>
            <h2>Current status</h2>
            <span className={`status-badge status-badge--${complaint.status.toLowerCase().replaceAll(' ', '-')}`}>
              {complaint.status}
            </span>
            <dl className="detail-facts">
              <div><dt><Tag size={14} aria-hidden="true" /> Category</dt><dd>{complaint.category}</dd></div>
              <div><dt><MapPin size={14} aria-hidden="true" /> Location</dt><dd>{complaint.location}</dd></div>
              <div><dt><CalendarDays size={14} aria-hidden="true" /> Reported</dt><dd>{new Date(complaint.created_at).toLocaleDateString()}</dd></div>
            </dl>
            {complaint.resolution_note && (
              <div className="detail-resolution">
                <p className="eyebrow">RESOLUTION NOTE</p>
                <p>{complaint.resolution_note}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </WorkspaceLayout>
  )
}

export default ComplaintDetailPage
