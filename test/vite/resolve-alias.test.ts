import vue from '@vitejs/plugin-vue'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resolveConfig, type Plugin, type ResolvedConfig } from 'vite'
import { attaform } from '../../src/vite'

/**
 * Coverage for the build-time `attaform/zod` alias hook. Drives the
 * plugin against per-test fixture roots that contain a synthetic
 * `node_modules/zod/package.json` so we control the resolved Zod
 * version without touching the real install.
 *
 * Fixtures are generated under `os.tmpdir()` rather than committed
 * into the repo:
 *   - `test/vite/fixtures/**\/node_modules` would be gitignored, so
 *     CI wouldn't see the fixtures.
 *   - Generating in tmpdir also escapes the repo's own
 *     `node_modules/zod`, so the no-zod case actually fails to
 *     resolve (it would otherwise walk up and find attaform's own
 *     dev-dep zod).
 */

let zodV4Root: string
let zodV3Root: string
let noZodRoot: string
let corruptZodRoot: string

function makeFixtureWithZod(name: string, zodVersion: string | null): string {
  const root = mkdtempSync(join(tmpdir(), `attaform-vite-fixture-${name}-`))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: `${name}-fixture`, private: true }),
    'utf8'
  )
  if (zodVersion !== null) {
    const zodDir = join(root, 'node_modules', 'zod')
    mkdirSync(zodDir, { recursive: true })
    writeFileSync(
      join(zodDir, 'package.json'),
      JSON.stringify({
        name: 'zod',
        version: zodVersion,
        main: './index.js',
        exports: { './package.json': './package.json', '.': './index.js' },
      }),
      'utf8'
    )
    writeFileSync(join(zodDir, 'index.js'), 'module.exports = {}\n', 'utf8')
  }
  return root
}

beforeAll(() => {
  zodV4Root = makeFixtureWithZod('zod-v4-only', '4.3.0')
  zodV3Root = makeFixtureWithZod('zod-v3-only', '3.24.0')
  noZodRoot = makeFixtureWithZod('no-zod', null)
  corruptZodRoot = makeFixtureWithZod('zod-corrupt', 'not-a-real-version')
})

afterAll(() => {
  // tmpdir entries are auto-cleaned by the OS on reboot; vitest's
  // sandbox doesn't require explicit removal. Skip rm-rf to keep the
  // teardown obviously safe.
})

async function resolveWithRoot(plugins: Plugin[], root: string): Promise<ResolvedConfig> {
  return resolveConfig({ plugins, configFile: false, root }, 'serve')
}

function findAttaformPlugin(config: ResolvedConfig): Plugin {
  const plugin = config.plugins.find((p) => p.name === 'attaform')
  if (plugin === undefined) throw new Error('attaform plugin not found in resolved config')
  return plugin
}

async function callResolveId(
  plugin: Plugin,
  source: string,
  importer: string | undefined = undefined
): Promise<unknown> {
  const hook = plugin.resolveId
  if (hook === undefined) return null
  // Vite/Rollup `resolveId` may be either a plain function or
  // `{ handler, order }`. The plugin we authored uses the function
  // form, but support both shapes for forward-compat.
  const handler = typeof hook === 'function' ? hook : hook.handler
  // The `this` context isn't strictly needed here — our hook reads
  // closure state — but bind a stub so calls don't blow up if a
  // future iteration uses `this.resolve`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handler as any).call({}, source, importer)
}

describe('attaform/vite — resolveId alias for `attaform/zod`', () => {
  it('rewrites `attaform/zod` to `attaform/zod-v4` when zod@4 is installed', async () => {
    const config = await resolveWithRoot([vue(), attaform()], zodV4Root)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform/zod', undefined)
    expect(resolved).toBe('attaform/zod-v4')
  })

  it('rewrites `attaform/zod` to `attaform/zod-v3` when zod@3 is installed', async () => {
    const config = await resolveWithRoot([vue(), attaform()], zodV3Root)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform/zod', undefined)
    expect(resolved).toBe('attaform/zod-v3')
  })

  it('throws at configResolved when zod is not installed', async () => {
    await expect(resolveWithRoot([vue(), attaform()], noZodRoot)).rejects.toThrow(
      /zod is not installed/
    )
  })

  it('falls through to runtime dispatch (with a one-time warn) when the version is unparseable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const config = await resolveWithRoot([vue(), attaform()], corruptZodRoot)
      const plugin = findAttaformPlugin(config)
      const resolved = await callResolveId(plugin, 'attaform/zod', undefined)
      // No alias target → resolveId returns null → consumer falls through
      // to the runtime-dispatch unified entry.
      expect(resolved).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not classify the installed Zod major')
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('passes through `attaform/zod-v3` unchanged (explicit subpath escape hatch)', async () => {
    const config = await resolveWithRoot([vue(), attaform()], zodV4Root)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform/zod-v3', undefined)
    expect(resolved).toBeNull()
  })

  it('passes through `attaform/zod-v4` unchanged', async () => {
    const config = await resolveWithRoot([vue(), attaform()], zodV4Root)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform/zod-v4', undefined)
    expect(resolved).toBeNull()
  })

  it('passes through `attaform` (root) unchanged', async () => {
    const config = await resolveWithRoot([vue(), attaform()], zodV4Root)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform', undefined)
    expect(resolved).toBeNull()
  })

  it('does not rewrite when `resolveZodAlias: false` is passed', async () => {
    const config = await resolveWithRoot([vue(), attaform({ resolveZodAlias: false })], zodV4Root)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform/zod', undefined)
    expect(resolved).toBeNull()
  })

  it('does not throw on missing zod when `resolveZodAlias: false` is passed', async () => {
    // The opt-out short-circuits BOTH the rewrite and the detection
    // check, so a consumer with no zod installed who explicitly opted
    // out doesn't see a build-time error from the plugin.
    const config = await resolveWithRoot([vue(), attaform({ resolveZodAlias: false })], noZodRoot)
    const plugin = findAttaformPlugin(config)
    const resolved = await callResolveId(plugin, 'attaform/zod', undefined)
    expect(resolved).toBeNull()
  })
})
