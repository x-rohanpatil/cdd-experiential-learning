import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { getNotifications } from '../services/api.js'

function readAuth() {
  try {
    return JSON.parse(sessionStorage.getItem('campusfix.auth') ?? 'null')
  } catch {
    return null
  }
}

function NavIcon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const shapes = {
    overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="4" rx="1" /><rect x="13.5" y="10.5" width="7" height="10" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /></>,
    report: <><path d="M7 3.5h8l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M15 3.5v5h4M9 13h6M12 10v6" /></>,
    complaints: <><path d="M5 5.5h14M5 10.5h14M5 15.5h9" /><path d="M3.5 3.5h17v17h-17z" /></>,
    tasks: <><path d="M4 7h16M4 12h11M4 17h8" /><path d="m16 16 2 2 3.5-4" /></>,
    campus: <><path d="M3 20.5h18M5 20V8l7-4 7 4v12M9 10v2M15 10v2M9 15v2M15 15v2M11 20v-4h2v4" /></>,
    locations: <><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" /><circle cx="12" cy="9" r="2.2" /></>,
    notifications: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    profile: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
    signout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>{shapes[name]}</svg>
}

function WorkspaceLayout({ title, children }) {
  const auth = readAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationError, setNotificationError] = useState('')

  useEffect(() => {
    const refreshUnread = () => {
      getNotifications()
        .then(({ data }) => {
          setUnreadCount(data.filter((item) => !item.read).length)
          setNotificationError('')
        })
        .catch(() => setNotificationError('Notifications are temporarily unavailable.'))
    }
    refreshUnread()
    window.addEventListener('campusfix:notifications-updated', refreshUnread)
    return () => window.removeEventListener('campusfix:notifications-updated', refreshUnread)
  }, [pathname])

  function signOut() {
    sessionStorage.removeItem('campusfix.auth')
    sessionStorage.removeItem('campusfix.student')
    navigate('/login', { replace: true })
  }

  const roleLinks = auth?.role === 'admin'
    ? [['/admin', 'Overview', 'overview'], ['/admin/qr-codes', 'Locations', 'locations']]
    : auth?.role === 'staff'
      ? [['/staff/tasks', 'My tasks', 'tasks']]
      : [['/dashboard', 'Overview', 'overview'], ['/report', 'Report issue', 'report'], ['/tracking', 'My complaints', 'complaints']]
  const links = [...roleLinks, ['/notifications', 'Notifications', 'notifications'], ['/profile', 'Profile', 'profile']]
  const homePath = roleLinks[0][0]
  const initials = (auth?.name || 'CampusFix')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="workspace-mobilebar">
        <Link className="workspace-brand" to={homePath} aria-label="CampusFix home">
          <span className="brand-mark">CF</span>
          <span className="brand-name">CampusFix</span>
        </Link>
        <div className="workspace-mobilebar__actions">
          {pathname !== '/notifications' && unreadCount > 0 && (
            <Link className="workspace-mobile-notice" to="/notifications" aria-label={`${unreadCount} unread notifications`}>
              <NavIcon name="notifications" /><span>{unreadCount}</span>
            </Link>
          )}
          <button className="workspace-signout" type="button" onClick={signOut} aria-label="Sign out">
            <NavIcon name="signout" />
          </button>
        </div>
      </header>
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <Link className="workspace-brand" to={homePath} aria-label="CampusFix home">
          <span className="brand-mark">CF</span>
          <span className="brand-name">CampusFix</span>
        </Link>
        <div className="workspace-sidebar__label">YOUR WORKSPACE <span>01 — 05</span></div>
        <nav className="workspace-nav" aria-label="Main navigation">
          {links.map(([href, label, icon], index) => (
            <NavLink
              className={({ isActive }) => `workspace-nav__link${isActive ? ' is-active' : ''}`}
              end
              key={href}
              to={href}
            >
              <span className="workspace-nav__index">{String(index + 1).padStart(2, '0')}</span>
              <NavIcon name={icon} />
              <span className="workspace-nav__text">{label}</span>
              {label === 'Notifications' && pathname !== '/notifications' && unreadCount > 0 && (
                <span className="workspace-nav__count">{unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="workspace-sidebar__note">
          <span className="workspace-sidebar__note-mark">+</span>
          <p>Better spaces<br /><strong>start with a report.</strong></p>
          {auth?.role === 'student' && <Link to="/report">Report an issue <span aria-hidden="true">↗</span></Link>}
        </div>
        <div className="workspace-sidebar__bottom">
          <Link className="workspace-user" to="/profile">
            <span className="workspace-user__avatar">{initials}</span>
            <span className="workspace-user__copy"><strong>{auth?.name || 'Campus member'}</strong><small>{auth?.role || 'Account'}</small></span>
            <span className="workspace-user__arrow" aria-hidden="true">↗</span>
          </Link>
          <button className="workspace-signout" type="button" onClick={signOut}>
            <NavIcon name="signout" /> <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="workspace-main" id="main-content">
        <section className="workspace-content">
          <header className="workspace-page-heading">
            <div>
              <p className="eyebrow eyebrow--blue">CAMPUSFIX <span>/</span> {auth?.role || 'WORKSPACE'}</p>
              <h1>{title}</h1>
            </div>
            <div className="workspace-page-heading__meta">
              <span className="workspace-date">CAMPUS OPERATIONS <i aria-hidden="true" /></span>
              {pathname !== '/notifications' && unreadCount > 0 && (
                <Link className="workspace-alert" to="/notifications">
                  <NavIcon name="notifications" /><span>{unreadCount} new update{unreadCount === 1 ? '' : 's'}</span>
                </Link>
              )}
            </div>
          </header>
          {pathname !== '/notifications' && notificationError && (
            <p className="form-message form-message--error" role="status">{notificationError}</p>
          )}
          <div className="workspace-page-content" key={title}>{children}</div>
          <footer className="workspace-footer"><span>CampusFix / Campus care, made visible.</span><span>OPERATIONS DESK <i aria-hidden="true" /> ACTIVE</span></footer>
        </section>
      </main>
    </div>
  )
}

export default WorkspaceLayout
