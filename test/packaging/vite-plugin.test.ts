import vue from '@vitejs/plugin-vue'
import { describe, expect, it } from 'vitest'
import { resolveConfig, type Plugin, type ResolvedConfig } from 'vite'
import { decant } from '../../src/vite'
import { inputTextAreaNodeTransform } from '../../src/runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from '../../src/runtime/lib/core/transforms/select-transform'

/**
 * Integration coverage for `decant/vite`. The plugin mutates
 * @vitejs/plugin-vue's options via the (informal) `api.options` surface;
 * if Vite's plugin resolution order or @vitejs/plugin-vue's api shape
 * changes, we want the build to break loudly, not at render time in a
 * consumer app.
 *
 * These tests use `resolveConfig` rather than a full Vite build so they
 * finish in <2s and don't touch the file system beyond config parsing.
 */

type VuePluginApi = {
  options?: {
    template?: {
      compilerOptions?: {
        nodeTransforms?: unknown[]
      }
    }
  }
}

async function resolveWith(plugins: Plugin[]): Promise<ResolvedConfig> {
  return resolveConfig({ plugins, configFile: false }, 'serve')
}

function getVueApi(config: ResolvedConfig): VuePluginApi | undefined {
  const vuePlugin = config.plugins.find((p) => p.name === 'vite:vue')
  return (vuePlugin as unknown as { api?: VuePluginApi } | undefined)?.api
}

describe('decant/vite — plugin registration', () => {
  it('registers both node transforms with @vitejs/plugin-vue', async () => {
    const config = await resolveWith([vue(), decant()])
    const api = getVueApi(config)
    const nodeTransforms = api?.options?.template?.compilerOptions?.nodeTransforms ?? []

    // Reference identity — the plugin must register OUR transform functions,
    // not wrappers. This rules out a regression where a bundler (e.g.
    // unbuild) accidentally wraps the export.
    expect(nodeTransforms).toContain(selectNodeTransform)
    expect(nodeTransforms).toContain(inputTextAreaNodeTransform)
  })

  it('preserves pre-existing nodeTransforms from earlier plugins', async () => {
    const sentinel = Symbol('sentinel-transform')
    const earlierPlugin: Plugin = {
      name: 'test:earlier',
      configResolved(resolved) {
        const api = getVueApi(resolved as ResolvedConfig)
        if (api === undefined) throw new Error('vite:vue not found')
        api.options ??= {}
        api.options.template ??= {}
        api.options.template.compilerOptions ??= {}
        const transforms = (api.options.template.compilerOptions.nodeTransforms ??= [])
        transforms.push(sentinel as unknown as (...args: unknown[]) => unknown)
      },
    }
    const config = await resolveWith([vue(), earlierPlugin, decant()])
    const api = getVueApi(config)
    const nodeTransforms = api?.options?.template?.compilerOptions?.nodeTransforms ?? []
    expect(nodeTransforms).toContain(sentinel)
    expect(nodeTransforms).toContain(selectNodeTransform)
    expect(nodeTransforms).toContain(inputTextAreaNodeTransform)
  })

  it('throws a helpful install-hint error when @vitejs/plugin-vue is missing', async () => {
    // The error message changed in E2 to differentiate "not installed"
    // from "found but version-incompatible". Match the new wording.
    await expect(resolveWith([decant()])).rejects.toThrow(/@vitejs\/plugin-vue is not installed/)
  })

  // E2 — second registration of decant() must NOT double-push
  // transforms. Pre-fix, two registrations stacked the transforms array
  // twice, double-injecting every binding the AST emits.
  it('is idempotent on duplicate registration', async () => {
    const config = await resolveWith([vue(), decant(), decant()])
    const api = getVueApi(config)
    const nodeTransforms = api?.options?.template?.compilerOptions?.nodeTransforms ?? []
    const selectCount = nodeTransforms.filter((t) => t === selectNodeTransform).length
    const inputCount = nodeTransforms.filter((t) => t === inputTextAreaNodeTransform).length
    expect(selectCount).toBe(1)
    expect(inputCount).toBe(1)
  })
})

describe('decant/vite — plugin order', () => {
  it('runs with enforce:"pre" so it is not downstream of other transforms', async () => {
    const config = await resolveWith([vue(), decant()])
    const cxPlugin = config.plugins.find((p) => p.name === 'decant')
    expect(cxPlugin).toBeDefined()
    expect(cxPlugin?.enforce).toBe('pre')
  })
})
