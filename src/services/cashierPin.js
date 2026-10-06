export const CASHIER_PIN_TTL_MS = 60 * 1000
const PROTECTED_SCOPES = new Set(['expenses', 'reports'])
let financialPinUnlock = null
const toBase64Url = bytes => String.fromCharCode(...bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const fromBase64Url = value => Uint8Array.from(atob(String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4)), char => char.charCodeAt(0))

export const createPinSalt = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export const hashCashierPin = async (pin, salt) => {
  const value = `${String(salt || '')}:${String(pin || '')}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toBase64Url(new Uint8Array(digest))
}

export const verifyCashierPin = async (pin, staff = {}) => {
  if (!staff?.pinEnabled || !staff?.pinHash || !staff?.pinSalt) return false
  const actual = await hashCashierPin(pin, staff.pinSalt)
  const expected = String(staff.pinHash)
  return actual.length === expected.length && [...actual].every((char, index) => char === expected[index])
}

export const readFinancialPinUnlock = () => {
  if (!financialPinUnlock || Number(financialPinUnlock.expiresAt) <= Date.now()) {
    financialPinUnlock = null
    return null
  }
  return { ...financialPinUnlock }
}

export const saveFinancialPinUnlock = scope => {
  if (!PROTECTED_SCOPES.has(scope)) return null
  const unlockedAt = Date.now()
  const value = { scope, authorizedAt: unlockedAt, expiresAt: unlockedAt + CASHIER_PIN_TTL_MS }
  financialPinUnlock = value
  return value
}

export const clearFinancialPinUnlock = () => { financialPinUnlock = null }
export const isFinancialPinUnlocked = scope => readFinancialPinUnlock()?.scope === scope

// Kept for tests and for environments without atob; PIN verification never stores this value.
export const decodePinSalt = value => fromBase64Url(value)
