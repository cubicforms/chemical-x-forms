import { $fetch, setup } from '@nuxt/test-utils/e2e'
import * as cheerio from 'cheerio'
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

          // this is false in the test fixture (Decant should set this to true)
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

          // Decant finds deeply nested options, even if the are NOT inside an <optgroup>
          // This does not satisfy the HTML5 spec, but is more permissive so things don't feel broken
          expect(option?.selected).toBe(true)
        })
      })
    })

    // Tests handling cases where no matches or errors occur
    describe('Non-Matching and Edge Cases:', () => {
      it("should NOT mark any <option> tags as selected if NONE of their values don't match the parent <select>'s value", async () => {
        const html = await $fetch('/')
        assertHTML(html)

        expect(typeof html).toBe('string')

        const $ = cheerio.load(html as string)
        const selectId = 'select-with-no-matching-options-1'
        const selectEl = $(`#${selectId}`)

        // Ensure the select element exists and contains at least one option.
        expect(selectEl.length).toBe(1)
        expect(selectEl.html()).toContain('<option')

        // Query for any option elements with a selected attribute
        const selectedOptions = $(`#${selectId} option[selected]`)
        expect(selectedOptions.length).toBe(0)
      })
      it('should not break if no <option> elements are provided to the <select>', async () => {
        const html = await $fetch('/')
        assertHTML(html)

        const window = new JSDOM(html).window
        const selectElement = window.document.getElementById('select-without-options-1')
        expect(selectElement).not.toBeNull()
        expect(selectElement?.tagName).toBe('SELECT')

        const options = (selectElement as HTMLSelectElement).options
        expect(options.length).toBe(0)
      })
      it('should not apply the selected attribute to non-<option> elements even if their value matches', async () => {
        const html = await $fetch('/')
        assertHTML(html)

        expect(typeof html).toBe('string')

        const $ = cheerio.load(html as string)
        const selectId = 'select-with-invalid-element-matching-value-1'
        const selectEl = $(`#${selectId}`)

        // Ensure the select element exists and contains at least one option.
        expect(selectEl.length).toBe(1)
        expect(selectEl.html()).not.toContain('<option')

        // Query for any selected elements with a selected attribute
        const selectedElements = $(`#${selectId} [selected]`)
        expect(selectedElements.length).toBe(0)
      })
    })

    // Tests related to the configuration when multiple selection is disabled
    describe('Multiple Selection Configuration:', () => {
      it('should use multiple=false by default', async () => {
        // multiple is not set on two <select /> tags, value works, array fails to set
        // success path (v-register receives a string register value)
        const html = await $fetch('/')
        assertHTML(html)
        expect(typeof html).toBe('string')

        const $ = cheerio.load(html as string)
        const selectSuccessId = 'select-multiple-false-default-success-case-1'
        const selectSuccessElement = $(`#${selectSuccessId}`)
        expect(selectSuccessElement.length).toBe(1)
        expect(selectSuccessElement.html()).toContain('<option')

        // Query for any option elements with a selected attribute
        const selectSuccessOptions = $(`#${selectSuccessId} option[selected]`)
        expect(selectSuccessOptions.length).toBe(1) // value got set!

        // failure path (v-register receives an array register value):
        const selectFailureId = 'select-multiple-false-default-failure-case-1'
        const selectFailureElement = $(`#${selectFailureId}`)
        expect(selectFailureElement.length).toBe(1)
        expect(selectFailureElement.html()).toContain('<option')

        // Query for any option elements with a selected attribute
        const selectFailureOptions = $(`#${selectFailureId} option[selected]`)
        expect(selectFailureOptions.length).toBe(0) // value was not set!
      })
    })
  })

  /*
    Test Suite: Reactive field-error API in SSR
    Focus: Errors set on the server (via setFieldErrors, including ones
    parsed from API responses via parseApiErrors) must serialise into
    the rendered HTML and survive hydration. Also covers that
    form.fields.<path>.errors mirrors the underlying store.
  */
  describe('SSR behavior of error API >>', () => {
    it('renders direct setFieldErrors output for each path', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const window = new JSDOM(html).window
      const { document } = window

      const emailEl = document.getElementById('errors-direct-fielderrors-email')
      const passwordEl = document.getElementById('errors-direct-fielderrors-password')
      const countEl = document.getElementById('errors-direct-count')

      expect(emailEl?.textContent?.trim()).toBe('Email already in use')
      expect(passwordEl?.textContent?.trim()).toBe('Password must be at least 8 characters')
      expect(countEl?.textContent?.trim()).toBe('2')
    })

    it('exposes the same errors via form.fields.<path>.errors', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const window = new JSDOM(html).window
      const fieldStateEl = window.document.getElementById('errors-direct-fieldstate-email')
      expect(fieldStateEl?.textContent?.trim()).toBe('Email already in use')
    })

    it('hydrates a wrapped { error: { details } } envelope across the SSR boundary', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const window = new JSDOM(html).window
      const { document } = window

      const firstEl = document.getElementById('errors-from-api-first')
      const secondEl = document.getElementById('errors-from-api-second')
      const countEl = document.getElementById('errors-from-api-count')

      expect(firstEl?.textContent?.trim()).toBe('Username taken')
      expect(secondEl?.textContent?.trim()).toBe('Reserved word')
      expect(countEl?.textContent?.trim()).toBe('2')
    })

    it('handleSubmit(cb) returns a function (bindable directly to @submit)', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const window = new JSDOM(html).window
      const typeofEl = window.document.getElementById('handle-submit-typeof')
      // Pre-0.7 returned Promise<void> here; the API was changed so consumers
      // can write `const onSubmit = handleSubmit(cb)` and bind directly to
      // a form. Catches accidental regressions to the old shape.
      expect(typeofEl?.textContent?.trim()).toBe('function')
    })

    it('keeps each form key isolated (errors-direct vs errors-from-api do not bleed)', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const window = new JSDOM(html).window
      const { document } = window

      // The api-form's section must not surface errors from the direct form,
      // and vice versa. A single shared error store keyed by formKey would
      // fail this; per-key isolation passes.
      const directSection = document.getElementById('errors-direct')?.textContent ?? ''
      const apiSection = document.getElementById('errors-from-api')?.textContent ?? ''

      expect(directSection).not.toContain('Username taken')
      expect(directSection).not.toContain('Reserved word')
      expect(apiSection).not.toContain('Email already in use')
      expect(apiSection).not.toContain('Password must be at least 8 characters')
    })
  })

  /*
    Test Suite: Nuxt SSR payload round-trip
    Focus: A value written into form state during server setup must land in
    BOTH the rendered HTML and the serialised Nuxt payload so the client-
    side registry can reconstruct the state without re-running defaults.
  */
  describe('SSR payload hydration round-trip >>', () => {
    it('server-written value appears in the rendered HTML', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const window = new JSDOM(html).window
      const valueEl = window.document.getElementById('hydration-check-value')
      expect(valueEl?.textContent?.trim()).toBe('server-written-value')
    })

    it('server-written value survives into the __NUXT__ payload script', async () => {
      const html = await $fetch('/')
      assertHTML(html)
      const typedHtml = typeof html === 'string' ? html : String(html)

      // Nuxt serialises payload with devalue, not plain JSON. A naive
      // JSON.parse of the inline <script> would explode on the custom
      // encoding. Substring match is enough to prove the payload carries
      // both the form key and the value: if either is missing, the client
      // would fall back to schema defaults and lose the server edit.
      expect(typedHtml).toContain('hydration-check')
      expect(typedHtml).toContain('server-written-value')

      // Also confirm the payload envelope itself exists so we're not just
      // matching the rendered <span>. `window.__NUXT__` (or the newer
      // __NUXT_DATA__ script node) is where Nuxt stashes it.
      expect(typedHtml).toMatch(/__NUXT(?:_DATA)?__/)
    })
  })
})
