/**
 * TypeScript shim for `.vue` Single-File Components.
 *
 * The library ships a few `.vue` files under `src/runtime/components/`
 * and `src/runtime/pages/` (the DevTools overlay panel + its iframe
 * route). `vue-tsc` understands `.vue` natively for build / declaration
 * emit, but `tsc --noEmit` (which the typecheck script uses) and test
 * files that import a `.vue` component need a module shim to recognize
 * the import as a Vue component default export.
 *
 * Bundlers (Vite / unbuild) handle the real resolution at build time;
 * this shim is type-system-only.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>
  export default component
}
