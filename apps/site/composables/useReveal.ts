/**
 * Reveal-on-scroll primitive.
 *
 * Marks an element with `data-revealed="true"` once it crosses 15% of
 * the viewport, which lets `[data-reveal]` CSS in `tailwind.css` run
 * the `reveal-fade-up` keyframe. Server-rendered HTML carries the
 * pre-reveal styles (opacity 0 + translate) so there's no hydration
 * flash; the observer attaches client-side and triggers the animation
 * exactly when the element is just about to enter the visual focus
 * zone (rootMargin of -10% on top + bottom).
 *
 * The observer is shared per Nuxt app instance — one IO handles every
 * `[data-reveal]` element on the page. Cheaper than spawning one IO
 * per element, and the observer is disposed on app unmount. `once: true`
 * semantics: each element disconnects after firing, so re-scrolling
 * past a revealed element doesn't replay the animation (which would
 * draw the eye for no reason).
 *
 * Usage:
 *
 *   const reveal = useReveal()
 *   const cardRef = ref<HTMLElement | null>(null)
 *   onMounted(() => cardRef.value && reveal.observe(cardRef.value))
 *
 * Or, more commonly, on a v-for: drop a `data-reveal` attribute on
 * each item and call `reveal.observeAll(parentRef.value)` once the
 * children are in the DOM.
 */
export function useReveal() {
  const nuxt = useNuxtApp()
  type RevealState = {
    observer: IntersectionObserver | null
    targets: WeakSet<Element>
  }
  const key = '$revealObserver' as const

  // Single observer per Nuxt app — store on nuxtApp so it survives
  // navigation but is GC'd with the app.
  if (!(key in nuxt) && import.meta.client) {
    const state: RevealState = {
      observer: null,
      targets: new WeakSet(),
    }
    state.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          // Set the data attribute that triggers the CSS animation;
          // unobserve immediately so the keyframe never replays.
          const el = entry.target as HTMLElement
          el.dataset.revealed = 'true'
          state.observer?.unobserve(el)
          state.targets.delete(el)
        }
      },
      {
        threshold: 0.15,
        rootMargin: '-10% 0px',
      }
    )
    ;(nuxt as unknown as Record<string, RevealState>)[key] = state
  }

  function observe(el: Element | null | undefined) {
    if (!el || !import.meta.client) return
    const state = (nuxt as unknown as Record<string, RevealState>)[key]
    if (!state || !state.observer || state.targets.has(el)) return
    state.targets.add(el)
    state.observer.observe(el)
  }

  function observeAll(root: Element | null | undefined) {
    if (!root || !import.meta.client) return
    root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => observe(el))
  }

  function unobserve(el: Element | null | undefined) {
    if (!el || !import.meta.client) return
    const state = (nuxt as unknown as Record<string, RevealState>)[key]
    if (!state || !state.observer) return
    state.observer.unobserve(el)
    state.targets.delete(el)
  }

  return { observe, observeAll, unobserve }
}
