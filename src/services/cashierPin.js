const UNLOCK_KEY = 'pos101.financialPinUnlock'
export const CASHIER_PIN_TTL_MS = 15 * 60 * 1000

const storage = () => typeof sessionStorage === 'undefined' ? null : sessionStorage
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
  try {
    const value = JSON.parse(storage()?.getItem(UNLOCK_KEY) || 'null')
    if (!value || Number(value.expiresAt) <= Date.now() || !value.cashierId) {
      storage()?.removeItem(UNLOCK_KEY)
      return null
    }
    return { cashierId: String(value.cashierId), unlockedAt: Number(value.unlockedAt), expiresAt: Number(value.expiresAt) }
  } catch {
    storage()?.removeItem(UNLOCK_KEY)
    return null
  }
}

export const saveFinancialPinUnlock = cashierId => {
  const unlockedAt = Date.now()
  const value = { cashierId: String(cashierId || ''), unlockedAt, expiresAt: unlockedAt + CASHIER_PIN_TTL_MS }
  if (!value.cashierId) return null
  storage()?.setItem(UNLOCK_KEY, JSON.stringify(value))
  return value
}

export const clearFinancialPinUnlock = () => storage()?.removeItem(UNLOCK_KEY)
export const isFinancialPinUnlocked = () => Boolean(readFinancialPinUnlock())

// Kept for tests and for environments without atob; PIN verification never stores this value.
export const decodePinSalt = value => fromBase64Url(value)
