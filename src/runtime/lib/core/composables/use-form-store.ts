import type { Ref } from 'vue'
import { computed, watch } from 'vue'

import { getForm, getValueFactory } from '../utils/get-value'
import { getHandleSubmitFactory, getValidateFactory } from '../utils/process-form'
import { setValueFactory } from '../utils/set-value'

import { unset } from 'lodash-es'
import { useState } from 'nuxt/app'
import type {
  FormKey,
  FormStore,
  FormSummaryStore,
  InitialStateResponse,
} from '../../../types/types-api'
import type { GenericForm } from '../../../types/types-core'
import { flattenObjectWithBaseKey } from '../utils/flatten-object'
import { setDifference, setIntersection } from '../utils/set-utilities'

export const useFormStore = <Form extends GenericForm>(
  formKey: FormKey,
  initialFormState: InitialStateResponse<Form>
) => {
  const formStore = useState<FormStore<Form>>('useform/store', () => new Map())
  const formSummaryStore = useState<FormSummaryStore>(
    'useform/form-summary-store',
    () => new Map([[formKey, {}]])
  )
  updateFormSummaryValuesRecord(initialFormState.data, undefined, formSummaryStore, formKey)

  // internally make sure form is registered
  if (!formStore.value.has(formKey)) {
    formStore.value.set(formKey, initialFormState.data)
  }

  const form = computed(() => getForm(formStore, formKey))

  watch(
    () => formStore.value.get(formKey),
    (currentForm, previousForm) => {
      updateFormSummaryValuesRecord(currentForm, previousForm, formSummaryStore, formKey)
    },
    { deep: true }
  )

  const formSummaryValues = computed(() => formSummaryStore.value.get(formKey)!)

  return {
    getHandleSubmitFactory,
    getValidateFactory,
    formSummaryValues,
    getValueFactory,
    setValueFactory,
    formStore,
    form,
  }
}

function updateFormSummaryValuesRecord<Form extends GenericForm>(
  currentForm: Form | undefined,
  previousForm: Form | undefined,
  formSummaryStore: Ref<FormSummaryStore>,
  formKey: FormKey
) {
  const summaryValues = formSummaryStore.value.get(formKey)
  if (!summaryValues) return

  const currentFlatForm = flattenObjectWithBaseKey(currentForm ?? {}) // returns { [string]: <primitive> }
  const previousFlatForm = flattenObjectWithBaseKey(previousForm ?? {}) // returns { [string]: <primitive> }

  // gather keys
  const currentFormKeySet = new Set(Object.keys(currentFlatForm))
  const previousFormKeySet = new Set(Object.keys(previousFlatForm))

  // categorize keys for easier processing
  const newKeys = setDifference(currentFormKeySet, previousFormKeySet)
  const deletedKeys = setDifference(previousFormKeySet, currentFormKeySet)
  const persistedKeys = setIntersection(currentFormKeySet, previousFormKeySet)

  // [defensive programming]: check what keys are actually present in the `summaryValues` record
  const summaryValuesKeys = new Set(Object.keys(summaryValues))
  const unknownPersistedKeys = setDifference(persistedKeys, summaryValuesKeys)
  const alreadyDeletedKeys = setDifference(deletedKeys, summaryValuesKeys)
  const preExistingSummaryKeys = setIntersection(newKeys, summaryValuesKeys)

  for (const key of alreadyDeletedKeys) {
    deletedKeys.delete(key)
  }

  // move unknown keys from `persistedKeys` to `newKeys`
  for (const key of unknownPersistedKeys) {
    persistedKeys.delete(key)
    newKeys.add(key)
  }

  // move already known keys from `newKeys` to `persistedKeys`
  for (const key of preExistingSummaryKeys) {
    persistedKeys.add(key)
    newKeys.delete(key)
  }

  for (const key of newKeys) {
    summaryValues[key] = {
      currentValue: currentFlatForm[key],
      previousValue: undefined,
      originalValue: currentFlatForm[key],
      pristine: true,
      dirty: false,
    }
  }

  for (const key of deletedKeys) {
    unset(summaryValues, key)
  }

  for (const key of persistedKeys) {
    const previousValue =
      previousFlatForm[key] === currentFlatForm[key]
        ? summaryValues[key]?.previousValue
        : previousFlatForm[key]
    const dirty = summaryValues[key]?.originalValue !== currentFlatForm[key]
    summaryValues[key] = {
      currentValue: currentFlatForm[key],
      previousValue: previousValue,
      originalValue: summaryValues[key]?.originalValue,
      pristine: !dirty,
      dirty,
    }
  }
}
