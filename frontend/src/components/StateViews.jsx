export function SkeletonLoader({ rows = 3, large = false, label = 'Loading content' }) {
  return (
    <div className="skeleton-stack" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className={`skeleton-row${large && index === 0 ? ' skeleton-row--large' : ''}`} key={index} aria-hidden="true" />
      ))}
    </div>
  )
}

export function EmptyIllustration({ variant = 'request' }) {
  return (
    <svg className={`empty-state__art empty-state__art--${variant}`} viewBox="0 0 240 150" role="img" aria-label="An isometric wireframe campus building">
      <path d="m27 110 82 30 103-37M46 99l81 30 86-31M66 89l80 29 68-25M86 79l79 29 49-18" fill="none" stroke="#e2e6ed" strokeWidth="1" />
      <path d="m55 92 58-33 72 26-59 34-71-27Z" fill="#fff" stroke="#aab3bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m55 92 71 27v-49L55 45v47Z" fill="#f9fafb" stroke="#aab3bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m126 119 59-34v-49l-59 34v49Z" fill="#fff" stroke="#aab3bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m55 45 59-34 71 25-59 34-71-25Z" fill="#fff" stroke="#aab3bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m72 51 58 21m-58-4 58 21m-58-4 58 21m-45-67v39m21-30v39m51-31v39m20-51v39" fill="none" stroke="#d9dee6" strokeWidth="1" />
      <path d="m103 80 12-7v17l-12-5v-5Z" fill="#e8faf3" stroke="#008c5d" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="195" cy="48" r="5" fill="#00d48a" />
      <path d="M195 53v17m-6-11h12" stroke="#008c5d" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
