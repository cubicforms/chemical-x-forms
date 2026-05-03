/**
 * Dev-only call-site capture for warnings that want to point the
 * reader at the offending line of their code (not at a attaform-internal
 * frame). Walks the stack past `attaform` frames, picks the
 * first frame that looks like user code, then strips the dev-server
 * scheme + host + Vite/Nuxt's `/_nuxt/` prefix so the warning doesn't
 * carry a wall of `https://localhost:3000/_nuxt/...` noise.
 *
 * Returns `undefined` on engines that don't expose `.stack` or when
 * parsing fails — callers should degrade to a generic message rather
 * than printing nothing.
 *
 * Click-through navigation isn't sacrificed: `console.warn` already
 * renders its own clickable stack trace below the message in
 * Chrome / Firefox DevTools (V8 frame format → Sources tab). The
 * captured frame is purely an inline pointer in the message text,
 * and short paths read better there than full URLs.
 *
 * The attaform-frame regex matches both the published path
 * (`attaform/...`) and the linked / source path
 * (`attaform/...`) so local dev via `make link-attaform` surfaces
 * the same trimmed frames.
 *
 * Dev-only; callers should gate on `__DEV__` before invoking.
 */
export function captureUserCallSite(): string | undefined {
  const raw = new Error().stack
  if (typeof raw !== 'string') return undefined
  const lines = raw.split('\n')
  // Skip the "Error" message line and any frame inside attaform itself.
  for (let i = 1; i < lines.length; i++) {
    const frame = lines[i]
    if (frame === undefined) continue
    if (/attaform[/-]forms?/i.test(frame)) continue
    if (/\bforms\.[A-Za-z0-9_-]+\.m?js\b/.test(frame)) continue
    const trimmed = frame.trim()
    if (trimmed.length === 0) continue
    return shortenSourceFrame(trimmed)
  }
  return undefined
}

/**
 * Reduce a raw stack frame to `(<path>:<line>)`.
 *
 * Inputs we expect (V8, with or without `at fn (…)` wrapper):
 *   - `at setup (https://example.test/_nuxt/pages/spike.vue:18:18)`
 *   - `at https://example.com/foo.js:1:1`
 *   - `at file:///Users/x/proj/spike.vue:18:18`
 *   - `pages/foo.vue:18:18` (already path-like, no V8 wrapper)
 *
 * Outputs:
 *   - `(pages/spike.vue:18)`
 *   - `(foo.js:1)`
 *   - `(Users/x/proj/spike.vue:18)`
 *   - `(pages/foo.vue:18)`
 *
 * Why drop the column: Vite's sourcemaps round-trip line accurately
 * but column resolution is fuzzy in compiled contexts (Vue render
 * functions, JSX, anywhere the source-to-output mapping isn't
 * 1-to-1 per character). For a script-setup `useForm()` call the
 * column is meaningful; for a template-inlined `register(...)` it
 * lands somewhere mid-compiled-blob and is actively misleading. The
 * uniform `path:line` format avoids that asymmetry — line is enough
 * to navigate, the editor lands on the right region either way.
 *
 * If the frame doesn't match the trailing `…:line:col` shape at all,
 * the original trimmed frame is returned unchanged — better to
 * surface something than nothing.
 */
export function shortenSourceFrame(frame: string): string {
  const match = /(?:^|\s|\()([^\s()]+):(\d+):\d+\)?$/.exec(frame)
  if (match === null) return frame
  const [, urlOrPath, line] = match
  if (urlOrPath === undefined || line === undefined) return frame
  let path = urlOrPath
  // Strip `scheme://host/` (https://…, http://…). file:// gets the
  // same treatment, leaving the absolute filesystem path; we then
  // also strip its leading slash below so it reads as a relative path.
  path = path.replace(/^[a-z]+:\/\/[^/]+\//i, '')
  // Strip Vite/Nuxt's dev-server prefix.
  path = path.replace(/^_nuxt\//, '')
  // Strip leading slash (left over from file:// or absolute paths).
  path = path.replace(/^\//, '')
  // Wrap in parens. Chrome's console auto-linker partial-matches
  // bare `pages/foo.vue:137` (it picks up `/foo.vue:137` and
  // drops the `pages` prefix). Parens are the V8 stack-frame
  // convention and Chrome reliably auto-links them end-to-end.
  return `(${path}:${line})`
}
