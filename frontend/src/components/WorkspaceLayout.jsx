import { useEffect, useState } from 'react'
import {
  Bell,
  Building2,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  QrCode,
  UserRound,
  Wrench,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { getNotifications } from '../services/api.js'

function readAuth() {
  try {
    return JSON.parse(sessionStorage.getItem('campusfix.auth') ?? 'null')
  } catch {
    return null
  }
}

function WorkspaceLayout({ title, children }) {
  const auth = readAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationError, setNotificationError] = useState('')

  useEffect(() => {
    if (pathname === '/notifications') return undefined
    getNotifications()
      .then(({ data }) => setUnreadCount(data.filter((item) => !item.read).length))
      .catch(() => setNotificationError('Notifications are temporarily unavailable.'))
    return undefined
  }, [pathname])

  function signOut() {
    sessionStorage.removeItem('campusfix.auth')
    sessionStorage.removeItem('campusfix.student')
    navigate('/login', { replace: true })
  }

  const roleLinks = auth?.role === 'admin'
    ? [['/admin', 'Overview', LayoutDashboard], ['/admin/campus-3d', 'Campus 3D', Building2], ['/admin/qr-codes', 'Locations', QrCode]]
    : auth?.role === 'staff'
      ? [['/staff/tasks', 'My tasks', Wrench]]
      : [
        ['/dashboard', 'Overview', LayoutDashboard],
        ['/report', 'Report issue', ClipboardList],
        ['/tracking', 'My complaints', Wrench],
      ]
  const links = [
    ...roleLinks,
    ['/notifications', 'Notifications', Bell],
    ['/profile', 'Profile', UserRound],
  ]
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
      <header className="workspace-mobilebar">
        <Link className="workspace-brand" to={homePath}>
          <span className="brand-mark">CF</span>
          <span className="brand-name">CampusFix</span>
        </Link>
        <button className="workspace-signout" type="button" onClick={signOut} aria-label="Sign out">
          <LogOut size={17} aria-hidden="true" />
        </button>
      </header>
      <aside className="workspace-sidebar">
        <Link className="workspace-brand" to={homePath}>
          <span className="brand-mark">CF</span>
          <span className="brand-name">CampusFix</span>
        </Link>
        <div className="workspace-sidebar__label">WORKSPACE</div>
        <nav className="workspace-nav" aria-label="Main navigation">
          {links.map(([href, label, Icon]) => (
            <NavLink
              className={({ isActive }) => `workspace-nav__link${isActive ? ' is-active' : ''}`}
              end
              key={href}
              to={href}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {label === 'Notifications' && pathname !== '/notifications' && unreadCount > 0 && (
                <span className="workspace-nav__count">{unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="workspace-sidebar__bottom">
          <Link className="workspace-user" to="/profile">
            <span className="workspace-user__avatar">{initials}</span>
            <span className="workspace-user__copy">
              <strong>{auth?.name || 'Campus member'}</strong>
              <small>{auth?.role || 'Account'}</small>
            </span>
          </Link>
          <button className="workspace-signout" type="button" onClick={signOut}>
            <LogOut size={17} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <main className="workspace-main">
        <section className="workspace-content">
          <header className="workspace-page-heading">
            <div>
              <p className="eyebrow eyebrow--blue">CAMPUSFIX / {auth?.role || 'WORKSPACE'}</p>
              <h1>{title}</h1>
            </div>
            {pathname !== '/notifications' && unreadCount > 0 && (
              <Link className="workspace-alert" to="/notifications">
                <Bell size={16} aria-hidden="true" />
                <span>{unreadCount} new update{unreadCount === 1 ? '' : 's'}</span>
              </Link>
            )}
          </header>
          {pathname !== '/notifications' && notificationError && (
            <p className="form-message form-message--error" role="status">{notificationError}</p>
          )}
          <div className="workspace-page-content" key={title}>
            {children}
          </div>
        </section>
      </main>
    </div>
  )
}

export default WorkspaceLayout
