import { describe, expect, it } from 'vitest'
import { humanize } from '../../src/runtime/core/humanize'

describe('humanize', () => {
  it('title-cases a simple lowercase segment', () => {
    expect(humanize('email')).toBe('Email')
  })

  it('splits camelCase into separate title-cased words', () => {
    expect(humanize('firstName')).toBe('First Name')
  })

  it('splits camelCase with consecutive caps respecting word boundaries', () => {
    expect(humanize('shipmentId')).toBe('Shipment Id')
  })

  it('splits snake_case', () => {
    expect(humanize('first_name')).toBe('First Name')
  })

  it('splits kebab-case', () => {
    expect(humanize('first-name')).toBe('First Name')
  })

  it('mixes underscores and dashes', () => {
    expect(humanize('first_name-suffix')).toBe('First Name Suffix')
  })

  it('handles single uppercase character segments', () => {
    expect(humanize('A')).toBe('A')
  })

  it('handles single-letter abbreviations in camelCase', () => {
    expect(humanize('aLetter')).toBe('A Letter')
  })

  it('returns empty string for numeric segments (array indices)', () => {
    expect(humanize(0)).toBe('')
    expect(humanize(42)).toBe('')
  })

  it('returns empty string for numeric-string segments (parsed array indices)', () => {
    expect(humanize('0')).toBe('')
    expect(humanize('123')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(humanize('')).toBe('')
  })

  it('collapses runs of whitespace', () => {
    expect(humanize('first   name')).toBe('First Name')
  })

  it('preserves digits inside words', () => {
    expect(humanize('mp3Player')).toBe('Mp3 Player')
  })
})
