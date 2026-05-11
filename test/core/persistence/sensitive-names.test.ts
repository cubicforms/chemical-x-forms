import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SENSITIVE_NAMES,
  createIsSensitivePath,
  createSegmentMatchesSensitive,
  isSensitivePath,
} from '../../../src/runtime/core/persistence/sensitive-names'

/**
 * Unit tests for the sensitive-name heuristic. The function is the
 * second-line guard above `acknowledgeSensitive: true`: it's a
 * code-review trigger, not a soundness boundary, and the patterns
 * are conservative.
 *
 * Suite asserts both inclusion (the stem set covers the common
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
    ['pinned'], // word boundary on `pin` prevents this
    ['tokenizer'], // word boundary on `token` prevents this
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

describe('DEFAULT_SENSITIVE_NAMES shape', () => {
  it('exports a non-empty frozen array of name stems', () => {
    expect(DEFAULT_SENSITIVE_NAMES.length).toBeGreaterThan(20)
    expect(Object.isFrozen(DEFAULT_SENSITIVE_NAMES)).toBe(true)
    for (const name of DEFAULT_SENSITIVE_NAMES) {
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    }
  })
})

describe('createIsSensitivePath — custom name lists', () => {
  it('extends DEFAULT_SENSITIVE_NAMES with a consumer addition', () => {
    const isSensitive = createIsSensitivePath([...DEFAULT_SENSITIVE_NAMES, 'mrn'])
    // The new stem flags
    expect(isSensitive(['mrn'])).toBe(true)
    expect(isSensitive(['patient', 'mrn'])).toBe(true)
    // The default stems still flag
    expect(isSensitive(['password'])).toBe(true)
    // Non-matching paths still don't flag
    expect(isSensitive(['email'])).toBe(false)
  })

  it('REPLACES the default when given a non-default list', () => {
    // A consumer who passes ONLY their own names loses the defaults —
    // that's the "replace, not extend" contract.
    const isSensitive = createIsSensitivePath(['mrn'])
    expect(isSensitive(['mrn'])).toBe(true)
    expect(isSensitive(['password'])).toBe(false)
  })

  it('empty list is explicit opt-out — nothing is sensitive', () => {
    const isSensitive = createIsSensitivePath([])
    expect(isSensitive(['password'])).toBe(false)
    expect(isSensitive(['ssn'])).toBe(false)
  })

  it('tolerates separators in consumer entries', () => {
    const isSensitive = createIsSensitivePath(['patient_mrn'])
    expect(isSensitive(['patient_mrn'])).toBe(true)
    expect(isSensitive(['patient-mrn'])).toBe(true)
    expect(isSensitive(['patientMrn'])).toBe(true)
  })

  it('createSegmentMatchesSensitive returns a per-segment closure', () => {
    const match = createSegmentMatchesSensitive([...DEFAULT_SENSITIVE_NAMES, 'mrn'])
    expect(match('mrn')).toBe(true)
    expect(match('password')).toBe(true)
    expect(match('email')).toBe(false)
    expect(match(0)).toBe(false) // numeric segments never match
  })
})
