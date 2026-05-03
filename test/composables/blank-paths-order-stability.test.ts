// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'

/**
 * `derivedBlankErrors` (computed off `blankPaths`) feeds
 * `form.meta.errors` alongside schemaErrors and userErrors. The
 * `reshapeUnionVariant` flow deletes every blank path under the
 * union's parentPath and unconditionally re-adds the new ones —
 * which, when a blank survives the reshape (same-discriminator
 * Case B write, or memory-restored variant), is a delete-then-add
 * on the same key. `Set.add` on a deleted key re-inserts at the END
 * of insertion order, so the aggregate `meta.errors` shifts even
 * though the underlying state didn't change.
 *
 * Same class of bug as `applySchemaErrorsForSubtree`'s delete-then-set
 * (b702c91). Same fix shape: only delete keys that genuinely drop
 * out of the new pass.
 */

type ApiFor<Schema extends z.ZodObject> = Omit<UseFormReturnType<z.output<Schema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
}

function mountForm<Schema extends z.ZodObject>(schema: Schema): { app: App; api: ApiFor<Schema> } {
  const handle: { api?: ApiFor<Schema> } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `blank-order-${Math.random().toString(36).slice(2)}`,
        validateOn: 'change',
        debounceMs: 0,
      }) as unknown as ApiFor<Schema>
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ApiFor<Schema> }
}

async function flushValidations(): Promise<void> {
  await nextTick()
  await new Promise<void>((r) => setTimeout(r, 0))
  await nextTick()
}

describe('derivedBlankErrors — insertion-order stability across DU reshape', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  // Two numeric blanks. `notify.n` lives under a DU parent; `age` is
  // a sibling at the root. Mount with NO user defaults so both
  // primitive leaves auto-mark in walk order (notify.n first, age
  // second). A same-disc Case B write to `notify` runs
  // `reshapeUnionVariant`, which drops every blank under `notify`
  // unconditionally and re-adds the new pass. `notify.n` survives
  // — Set.add on a deleted key re-inserts at the END, so insertion
  // order flips to [age, notify.n].
  const schema = z.object({
    notify: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('num'), n: z.number() }),
      z.object({ kind: z.literal('txt'), t: z.string().min(1) }),
    ]),
    age: z.number(),
  })

  it('same-disc Case B reshape preserves blankPaths order', async () => {
    // Omitted defaults — the construction-time walker auto-marks
    // every numeric primitive leaf in schema-declaration order.
    const { app, api } = mountForm(schema)
    apps.push(app)
    await flushValidations()

    const initialBlanks = [...api.blankPaths.value]
    expect(initialBlanks).toEqual([JSON.stringify(['notify', 'n']), JSON.stringify(['age'])])

    api.setValue('notify', { kind: 'num', n: 0 })
    await flushValidations()

    const afterReshapeBlanks = [...api.blankPaths.value]
    expect(afterReshapeBlanks).toEqual(initialBlanks)
  })

  it('same-disc Case B reshape preserves form.meta.errors order', async () => {
    const { app, api } = mountForm(schema)
    apps.push(app)
    await flushValidations()

    const initialPaths = api.meta.errors.map((e) => e.path.join('.'))
    expect(initialPaths).toEqual(['notify.n', 'age'])

    api.setValue('notify', { kind: 'num', n: 0 })
    await flushValidations()

    const afterPaths = api.meta.errors.map((e) => e.path.join('.'))
    expect(afterPaths).toEqual(initialPaths)
  })
})
