import { describe, expect, it } from 'vitest'
import {
  isSensitivePath,
  SENSITIVE_NAME_PATTERNS,
} from '../../../src/runtime/core/persistence/sensitive-names'

/**
 * Unit tests for the sensitive-name heuristic. The function is the
 * second-line guard above `acknowledgeSensitive: true`: it's a
 * code-review trigger, not a soundness boundary, and the patterns
 * are conservative.
 *
 * Suite asserts both inclusion (the pattern set covers the common
 * footguns) and exclusion (typical-sounding non-sensitive names
 * don't trip the heuristic).
 */

describe('isSensitivePath — credentials & passwords', () => {
  it.each([
    ['password'],
    ['userPassword'],
    ['passwd'],
    ['PASSWD'],
    ['pwd'],
    ['PWD'],
    ['passwords'],
    ['recovery_code'],
    ['recovery-code'],
    ['backupCode'],
  ])('flags %s as sensitive', (segment) => {
    expect(isSensitivePath([segment])).toBe(true)
  })
})

describe('isSensitivePath — payment / card', () => {
  it.each([
    ['cvv'],
    ['cvc'],
    ['cardNumber'],
    ['card_number'],
    ['card-num'],
    ['card'],
    ['iban'],
    ['routing_number'],
    ['accountNumber'],
  ])('flags %s as sensitive', (segment) => {
    expect(isSensitivePath([segment])).toBe(true)
  })
})

describe('isSensitivePath — government / identity', () => {
  it.each([
    ['ssn'],
    ['SSN'],
    ['socialSecurity'],
    ['social_security_number'],
    ['dob'],
    ['DOB'],
    ['date_of_birth'],
    ['dateOfBirth'],
    ['passport'],
    ['passportNumber'],
    ['driver_license'],
    ['driverLicense'],
  ])('flags %s as sensitive', (segment) => {
    expect(isSensitivePath([segment])).toBe(true)
  })
})

describe('isSensitivePath — tax IDs', () => {
  it.each([['tin'], ['ein'], ['itin'], ['taxId'], ['tax-id'], ['tax_id']])(
    'flags %s as sensitive',
    (segment) => {
      expect(isSensitivePath([segment])).toBe(true)
    }
  )
})

describe('isSensitivePath — tokens / api credentials', () => {
  it.each([
    ['token'],
    ['tokens'],
    ['apiKey'],
    ['api_key'],
    ['apiSecret'],
    ['api-secret'],
    ['apiToken'],
    ['privateKey'],
    ['private-key'],
    ['secret'],
    ['secrets'],
    ['bearer'],
    ['oauth'],
    ['authToken'],
    ['auth_token'],
    ['access_token'],
    ['refresh_token'],
    ['sessionId'],
    ['session_key'],
    ['session_token'],
  ])('flags %s as sensitive', (segment) => {
    expect(isSensitivePath([segment])).toBe(true)
  })
})

describe('isSensitivePath — MFA / OTP / 2FA', () => {
  it.each([
    ['otp'],
    ['OTP'],
    ['oneTimePassword'],
    ['one_time_code'],
    ['mfaSecret'],
    ['mfa_seed'],
    ['mfaCode'],
    ['mfa-token'],
    ['twoFactorCode'],
    ['two_factor_token'],
    ['2fa'],
    ['2fa_code'],
  ])('flags %s as sensitive', (segment) => {
    expect(isSensitivePath([segment])).toBe(true)
  })
})

describe('isSensitivePath — false positives we deliberately avoid', () => {
  it.each([
    ['description'], // contains "tion" but no sensitive token
    ['descriptor'], // not "secret"
    ['displayName'],
    ['email'],
    ['username'],
    ['firstName'],
    ['lastName'],
    ['fullName'],
    ['title'],
    ['address'], // not "card"
    ['nickname'],
    ['avatar'],
    ['profile'],
    ['greeting'],
  ])('does not flag %s as sensitive', (segment) => {
    expect(isSensitivePath([segment])).toBe(false)
  })
})

describe('isSensitivePath — path-shape dispatch', () => {
  it('matches when ANY segment of a Path[] is sensitive', () => {
    expect(isSensitivePath(['profile', 'password'])).toBe(true)
    expect(isSensitivePath(['security', 'mfa', 'secret'])).toBe(true)
  })

  it('returns false when no segment matches', () => {
    expect(isSensitivePath(['profile', 'displayName'])).toBe(false)
  })

  it('parses dotted-string paths', () => {
    expect(isSensitivePath('profile.password')).toBe(true)
    expect(isSensitivePath('profile.email')).toBe(false)
  })

  it('parses canonical PathKey JSON form', () => {
    expect(isSensitivePath('["profile","password"]')).toBe(true)
    expect(isSensitivePath('["profile","email"]')).toBe(false)
  })

  it('flags array-indexed paths through structured form', () => {
    // `user.session.0.password` — a sensitive leaf inside an array.
    // Numeric segments are non-string and skipped silently; the
    // 'password' segment still triggers.
    expect(isSensitivePath(['user', 'session', 0, 'password'])).toBe(true)
    expect(isSensitivePath(['accounts', 2, 'cvv'])).toBe(true)
  })

  it('flags array-indexed paths through dotted-string form', () => {
    expect(isSensitivePath('user.session.0.password')).toBe(true)
    expect(isSensitivePath('accounts.2.cvv')).toBe(true)
  })

  it('flags array-indexed paths through canonical PathKey JSON', () => {
    expect(isSensitivePath('["user","session",0,"password"]')).toBe(true)
    expect(isSensitivePath('["accounts",2,"cvv"]')).toBe(true)
  })
})

describe('SENSITIVE_NAME_PATTERNS shape', () => {
  it('exports a non-empty readonly array of RegExp', () => {
    expect(SENSITIVE_NAME_PATTERNS.length).toBeGreaterThan(20)
    for (const pattern of SENSITIVE_NAME_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp)
    }
  })
})
