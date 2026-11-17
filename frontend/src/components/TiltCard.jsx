function TiltCard({ children, className = '' }) {
  function handlePointerMove(event) {
    if (event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width
    const y = (event.clientY - bounds.top) / bounds.height
    event.currentTarget.style.setProperty('--tilt-x', `${(0.5 - y) * 4}deg`)
    event.currentTarget.style.setProperty('--tilt-y', `${(x - 0.5) * 5}deg`)
  }

  function resetTilt(event) {
    event.currentTarget.style.setProperty('--tilt-x', '0deg')
    event.currentTarget.style.setProperty('--tilt-y', '0deg')
  }

  return (
    <article
      className={`tilt-card ${className}`.trim()}
      onPointerLeave={resetTilt}
      onPointerMove={handlePointerMove}
    >
      {children}
    </article>
  )
}

export default TiltCard
