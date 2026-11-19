import { ArrowDown, ArrowRight, ClipboardCheck, MapPin, ShieldCheck } from '../components/Icons.jsx'
import { Link } from 'react-router-dom'

const features = [
  {
    icon: ClipboardCheck,
    title: 'Report clearly',
    description: 'Share the details, location, and a photo so the right team has what they need.',
  },
  {
    icon: MapPin,
    title: 'Follow every update',
    description: 'See the current status of your request and know when a repair is ready to verify.',
  },
  {
    icon: ShieldCheck,
    title: 'One trusted workspace',
    description: 'Students, maintenance teams, and administrators stay connected from report to resolution.',
  },
]

function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Welcome navigation">
        <Link className="brand-lockup" to="/" aria-label="CampusFix home">
          <span className="brand-mark">CF</span>
          <span className="brand-name">CampusFix</span>
        </Link>
        <div className="landing-nav__actions">
          <Link className="landing-nav__login" to="/login">Sign in</Link>
          <Link className="button button--small button--primary" to="/register">
            Get started <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <span className="eyebrow eyebrow--blue">A better campus starts here</span>
          <h1>Small fixes.<br /><span>Better days.</span></h1>
          <p>
            A clearer way to report campus issues, follow progress, and bring
            everyday spaces back to their best.
          </p>
          <div className="landing-hero__actions">
            <Link className="button button--primary" to="/login">
              Open your workspace <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className="button button--quiet" href="#how-it-works">
              Explore CampusFix <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <p className="landing-hero__note">For students, campus teams, and administrators.</p>
        </div>

        <div className="landing-orbit" aria-hidden="true">
          <div className="landing-orbit__ring landing-orbit__ring--outer" />
          <div className="landing-orbit__ring landing-orbit__ring--inner" />
          <div className="landing-preview">
            <div className="landing-preview__top">
              <span className="landing-preview__dot" />
              <span className="landing-preview__dot" />
              <span className="landing-preview__dot" />
              <span>CampusFix workspace</span>
            </div>
            <div className="landing-preview__body">
              <span className="landing-preview__label">A connected campus</span>
              <strong>From report<br />to resolution.</strong>
              <div className="landing-preview__track">
                <span className="landing-preview__track-point landing-preview__track-point--active" />
                <span className="landing-preview__track-line" />
                <span className="landing-preview__track-point" />
                <span className="landing-preview__track-line" />
                <span className="landing-preview__track-point" />
              </div>
              <div className="landing-preview__caption">
                <span>Report</span><span>Assigned</span><span>Resolved</span>
              </div>
            </div>
          </div>
          <span className="orbit-tag orbit-tag--one">Thoughtful campus care</span>
          <span className="orbit-tag orbit-tag--two">Every issue, in view</span>
        </div>
      </section>

      <section className="landing-features" id="how-it-works">
        <div className="landing-features__heading">
          <span className="eyebrow eyebrow--blue">Made for the whole campus</span>
          <h2>One simple path to a better space.</h2>
        </div>
        <div className="landing-features__grid">
          {features.map(({ icon: Icon, title, description }, index) => (
            <article className="landing-feature glass-card" key={title}>
              <span className="landing-feature__icon"><Icon size={20} aria-hidden="true" /></span>
              <span className="landing-feature__index">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <footer className="landing-footer">
        <Link className="brand-lockup" to="/" aria-label="CampusFix home">
          <span className="brand-mark">CF</span>
          <span className="brand-name">CampusFix</span>
        </Link>
        <span>Campus operations, simplified.</span>
      </footer>
    </main>
  )
}

export default LandingPage
