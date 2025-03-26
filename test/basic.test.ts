import { setup } from '@nuxt/test-utils/e2e'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

/*
  Test Suite: Behavior of the useForm API for <select> elements (SSR)
  Focus: Verify that SSR correctly applies the `selected` attribute to <option> elements based on matching logic
  when the <select> element is not in multiple mode.
*/

describe('Behavior of the useForm API', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  describe('SSR behavior for <select> elements (multiple=false)', () => {
    // Tests related to how matching <option> elements are selected
    describe('Matching Logic', () => {
      it('should mark the first matching <option> tag as selected', { todo: true })
      it('should only mark the first matching <option> tag as selected', { todo: true })
      it('should update an <option> element to be selected when its value matches', { todo: true })
      it('should ignore <option> elements without a specified value', { todo: true })
      it('should find a match in an arbitrarily nested <option> within the <select> DOM tree', {
        todo: true,
      })
      it(
        'should de-select any manually selected <option> elements that do not match the input value',
        { todo: true }
      )
    })

    // Tests handling cases where no matches or errors occur
    describe('Non-Matching and Edge Cases', () => {
      it(
        "should NOT mark any <option> tags as selected if their values don't match the parent <select>'s value",
        { todo: true }
      )
      it('should not break if no matching <option> elements are found', { todo: true })
      it('should not break if no <option> elements are provided to the <select>', { todo: true })
      it(
        'should not apply the selected attribute to non-<option> elements even if their value matches',
        { todo: true }
      )
    })

    // Tests related to the configuration when multiple selection is disabled
    describe('Multiple Selection Configuration', () => {
      it('should use multiple=false by default', { todo: true })
      it('should accept a ref for multiple with a value of false when matching an <option>', {
        todo: true,
      })
      it('should accept a false boolean for multiple when matching an <option> during SSR', {
        todo: true,
      })
      it(
        'should not set any <option> elements as selected if multiple is false and an array of string values is provided',
        { todo: true }
      )
    })
  })
})
