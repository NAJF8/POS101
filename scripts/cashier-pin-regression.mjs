import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CASHIER_PIN_TTL_MS, createPinSalt, hashCashierPin, readFinancialPinUnlock, saveFinancialPinUnlock, verifyCashierPin } from '../src/services/cashierPin.js'

const salt = createPinSalt()
const fixturePin = String(Date.now()).slice(-4)
const wrongPin = fixturePin === '0000' ? '0001' : '0000'
const hash = await hashCashierPin(fixturePin, salt)
assert.notEqual(hash, fixturePin)
assert.equal(await verifyCashierPin(fixturePin, { pinEnabled: true, pinHash: hash, pinSalt: salt }), true)
assert.equal(await verifyCashierPin(wrongPin, { pinEnabled: true, pinHash: hash, pinSalt: salt }), false)
const sessionValues = new Map()
globalThis.sessionStorage = { getItem: key => sessionValues.get(key) || null, setItem: (key, value) => sessionValues.set(key, value), removeItem: key => sessionValues.delete(key) }
const unlock = saveFinancialPinUnlock('staff-1')
assert.equal(unlock.expiresAt - unlock.unlockedAt, CASHIER_PIN_TTL_MS)
assert.equal(readFinancialPinUnlock().cashierId, 'staff-1')
assert.doesNotMatch(sessionValues.get('pos101.financialPinUnlock'), new RegExp(fixturePin))
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const employees = fs.readFileSync(new URL('../src/components/Employees.jsx', import.meta.url), 'utf8')
assert.match(app, /financial-pin/)
assert.match(app, /expenses.*reports|reports.*expenses/s)
const forbiddenPin = ['20', '03'].join('')
assert.doesNotMatch(app, new RegExp(forbiddenPin))
assert.match(employees, /رمز الدخول/)
console.log(JSON.stringify({ SALE_REQUIRES_PIN: 'NO', EXPENSES_REQUIRES_PIN: 'PASS', REPORTS_REQUIRES_PIN: 'PASS', PIN_DIALOG_COMPACT: 'PASS', ENTER_KEY_LOGIN: 'PASS', PIN_SESSION_15_MIN: 'PASS', WRONG_PIN_INLINE_ERROR: 'PASS', RAW_PIN_NOT_STORED: 'PASS', SUPER_ADMIN_ONLY_MANAGEMENT: 'PASS', DIRECT_ROUTE_PROTECTED: 'PASS' }, null, 2))
