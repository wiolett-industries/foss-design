const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/** How long `.target-ripple` runs (styles.css), with its delay. */
const RIPPLE_MS = 2200

/**
 * Draws the eye to `target` with two rings spreading out from its edge (as Gateway does for the
 * section a link led to): after scrolling to it, or to a notice that must not go unseen. The rings
 * are the element's own box-shadow, following its border radius, so give it to an element without a
 * shadow of its own that nothing clips. Calling it again starts it over.
 */
export function ripple(target: HTMLElement, color = 'var(--action)') {
  clearTimeout(timers.get(target))
  target.classList.remove('target-ripple')
  // A reflow between removing and adding the class restarts the animation.
  void target.offsetWidth
  target.style.setProperty('--ripple-color', color)
  target.classList.add('target-ripple')
  timers.set(
    target,
    setTimeout(() => {
      target.classList.remove('target-ripple')
      target.style.removeProperty('--ripple-color')
    }, RIPPLE_MS),
  )
}
