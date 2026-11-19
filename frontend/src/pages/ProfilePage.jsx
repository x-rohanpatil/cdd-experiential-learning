import { ShieldCheck, UserRound } from '../components/Icons.jsx'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'

function readSessionValue(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function ProfilePage() {
  const auth = readSessionValue('campusfix.auth') ?? {}
  const student = readSessionValue('campusfix.student') ?? {}
  const roleNames = { student: 'Student', staff: 'Maintenance staff', admin: 'Administrator' }
  const profileFields = [
    ['Full name', auth.name || student.name],
    ['Role', roleNames[auth.role] || 'Campus member'],
    ['Student ID', student.usn],
    ['Account ID', auth.id],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '')

  return (
    <WorkspaceLayout title="Your profile">
      <section className="profile-layout">
        <div className="profile-card profile-card--pass glass-card">
          <span className="profile-card__avatar"><UserRound size={28} aria-hidden="true" /></span>
          <p className="eyebrow eyebrow--blue">CAMPUSFIX ACCOUNT</p>
          <h2>{auth.name || 'Campus member'}</h2>
          <span className="profile-card__role">{roleNames[auth.role] || 'Campus member'}</span>
          <div className="profile-fields">
            {profileFields.map(([label, value]) => (
              <div className={`profile-field${label === 'Student ID' ? ' profile-field--identifier' : ''}`} key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
        <aside className="profile-note glass-card">
          <span className="profile-note__icon"><ShieldCheck size={20} aria-hidden="true" /></span>
          <h3>Your account, protected</h3>
          <p>
            Account details are managed by your campus. To update your name or
            sign-in information, contact your campus administrator.
          </p>
        </aside>
      </section>
    </WorkspaceLayout>
  )
}

export default ProfilePage
