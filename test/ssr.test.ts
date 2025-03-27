import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertHTML } from './utils/assert-html'

/*
  Test Suite: Behavior of useForm API with SSR
  Focus: Verify that SSR correctly applies the `selected` attribute to <option> elements based on matching logic
  when the <select> element is not in multiple mode.
*/

describe('SSR behavior of useForm', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/ssr', import.meta.url)),
  })

  describe('SSR behavior for <select> elements (multiple=false) >>', () => {
    // Tests related to how matching <option> elements are selected
    describe('Matching Logic:', () => {
      describe('When one or more matches are found', () => {
        it('should select a matching <option> element', async () => {
          const html = await $fetch('/')
          assertHTML(html)
          const window = new JSDOM(html).window
          const selectElement = window.document.getElementById('matching-logic-select-1')
          expect(selectElement).not.toBeNull()
          expect(selectElement?.tagName).toBe('SELECT')

          const options = (selectElement as HTMLSelectElement)?.options
          const selectedOption = options[options.selectedIndex]

          expect(selectedOption).not.toBeUndefined()
          expect(selectedOption?.selected).toBe(true)
          expect(selectedOption?.value).toBe('chess')
        })
        it('should only mark the LAST matching <option> element as selected', async () => {
          const html = await $fetch('/')
          assertHTML(html)

          const window = new JSDOM(html).window
          const selectElement = window.document.getElementById('matching-logic-select-1')
          expect(selectElement).not.toBeNull()
          expect(selectElement?.tagName).toBe('SELECT')

          const options = (selectElement as HTMLSelectElement).options
          const selectedOption = options[options.selectedIndex]

          expect(selectedOption).not.toBeUndefined()
          expect(selectedOption?.selected).toBe(true)
          expect(selectedOption?.textContent).toBe('Chess Bottom')

          // find remaining <option /> tags with value of `chess` and selected of `true`
          const otherSelectedChessOptions = [...options].filter(
            (option) =>
              option.value === 'chess' && option.textContent !== 'Chess Bottom' && option.selected
          )

          // Ensure that no other elements are selected
          expect(otherSelectedChessOptions).toHaveLength(0)
        })
        it('should update an UNSELECTED <option> element to be selected when its value matches', async () => {
          const html = await $fetch('/')
          assertHTML(html)

          const window = new JSDOM(html).window
          const selectElement = window.document.getElementById('matching-logic-select-2')
          expect(selectElement).not.toBeNull()
          expect(selectElement?.tagName).toBe('SELECT')

          const options = (selectElement as HTMLSelectElement)?.options
          expect(options.length).toBe(1)
          const option = options[0]
          expect(option?.value).toBe('chess')

          // this is false in the test fixture (Chemical X should set this to true)
          expect(option?.selected).toBe(true)
        })
        it('should find a match in an arbitrarily nested <option> within the <select> DOM tree', async () => {
          const html = await $fetch('/')
          assertHTML(html)

          const window = new JSDOM(html).window
          const selectElement = window.document.getElementById('random-nested-select-1')
          expect(selectElement).not.toBeNull()
          expect(selectElement?.tagName).toBe('SELECT')

          const options = (selectElement as HTMLSelectElement).options
          expect(options).toHaveLength(1)

          const option = options[0]
          expect(option).toBeDefined()
          expect(option?.value).toBe('chess')
          expect(option?.textContent).toBe('Chess Option Nested')

          // Chemical X finds deeply nested options, even if the are NOT inside an <optgroup>
          // This does not satisfy the HTML5 spec, but is more permissive so things don't feel broken
          expect(option?.selected).toBe(true)
        })
      })

      // This aligns with how browsers select options when parsing HTML for the initial render
      // Avoiding potential subtle bugs by implementing Chemical X s.t. these rules are followed
      describe('When no matches are found', () => {
        it('should select first option if no options have a selected attribute', { todo: true })
        it('should select last option with selected attribute', { todo: true })
      })
    })

    // Tests handling cases where no matches or errors occur
    describe('Non-Matching and Edge Cases:', () => {
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
    describe('Multiple Selection Configuration:', () => {
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
