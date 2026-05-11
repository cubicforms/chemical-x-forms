/**
 * lint-staged runs the configured commands against files staged for
 * commit. The string-keyed rules below are run per matched file; the
 * function-keyed rule for `apps/site/**` runs a single whole-project
 * vue-tsc pass when ANY site file is staged, so REPL-demo type
 * regressions (like the form.undo → form.history.undo rename) fail
 * the commit before they ship.
 *
 * The site typecheck takes ~8s. We pay it only when an apps/site
 * file is touched, which is rare on commits that don't change the
 * site.
 */
export default {
  './src/**/*.{ts,vue}': 'eslint',
  './apps/site/**/*.{ts,vue}': (files) => {
    // Per-file eslint, then one whole-project vue-tsc pass — the
    // typecheck arg is ignored if `files` is empty (lint-staged
    // wouldn't have invoked us in that case). The function form
    // suppresses lint-staged's default behaviour of appending the
    // matched file list to the typecheck command.
    return [
      `eslint ${files.join(' ')}`,
      'pnpm --filter attaform-site typecheck',
    ]
  },
  './test/**/*.{ts,vue}': 'eslint',
  '**/*.{ts,js,vue,css,scss,md,json,yml,yaml}': 'prettier --write',
}
