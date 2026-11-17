import { useEffect, useState } from 'react'
import { Bell, Check, Circle } from 'lucide-react'
import { Link } from 'react-router-dom'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { getApiErrorMessage, getNotifications, markNotificationRead } from '../services/api.js'

function NotificationsPage() {
  const [notifications, setNotifications] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [updating, setUpdating] = useState(null)

  useEffect(() => {
    let active = true
    getNotifications()
      .then(({ data }) => {
        if (active) setNotifications(data)
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Unable to load notifications.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  async function markRead(id) {
    setError('')
    setUpdating(id)
    try {
      await markNotificationRead(id)
      setNotifications((items) => items.map((item) => item.id === id ? { ...item, read: true } : item))
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to update this notification.'))
    } finally {
      setUpdating(null)
    }
  }

  return (
    <WorkspaceLayout title="Notifications">
      <div className="notifications-heading">
        <div>
          <p className="eyebrow eyebrow--blue">YOUR UPDATES</p>
          <p>Updates from the teams looking after your campus.</p>
        </div>
        <span className="notifications-heading__count">
          {isLoading || error ? '—' : `${notifications.filter((item) => !item.read).length} unread`}
        </span>
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      {isLoading && <p className="workspace-empty">Loading notifications…</p>}
      {!isLoading && !error && notifications.length === 0 && (
        <div className="empty-state glass-card">
          <span className="empty-state__icon"><Bell size={22} aria-hidden="true" /></span>
          <h2>You’re all caught up</h2>
          <p>New updates about your requests will appear here.</p>
        </div>
      )}
      <div className="notifications-list">
        {notifications.map((item) => (
          <article className={`notification-card glass-card${item.read ? '' : ' notification-card--unread'}`} key={item.id}>
            <span className="notification-card__icon">{item.read ? <Check size={17} /> : <Circle size={12} fill="currentColor" />}</span>
            <div className="notification-card__body">
              <p>{item.message}</p>
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
            </div>
            {item.complaint_id && (
              <Link className="text-link" to={`/complaints/${item.complaint_id}`}>View request</Link>
            )}
            {!item.read && (
              <button className="notification-card__action" disabled={updating === item.id} type="button" onClick={() => markRead(item.id)}>
                {updating === item.id ? 'Saving…' : 'Mark read'}
              </button>
            )}
          </article>
        ))}
      </div>
    </WorkspaceLayout>
  )
}

export default NotificationsPage
