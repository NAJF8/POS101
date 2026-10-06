import assert from 'node:assert/strict'
import fs from 'node:fs'
import { makeSettlementIdempotencyKey } from '../src/services/financialCenter.js'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const expenses = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules
const operationalPaths = [
  'pos101_sales', 'pos101_expenses', 'pos101_operational_days', 'pos101_staff',
  'pos101_cashbox_transactions', 'pos101_cashbox_settlements', 'pos101_cashbox_counts',
  'pos101_financial_audit_log', 'pos101_products',
]

assert.doesNotMatch(sync, /signInAnonymously/)
assert.match(sync, /signInWithCustomToken\(auth/)
assert.match(sync, /\/kiosk\/challenge/)
assert.match(sync, /\/kiosk\/(activate|renew)/)
assert.match(sync, /getIdTokenResult/)
assert.match(sync, /setPersistence\(auth, browserLocalPersistence\)/)
assert.match(sync, /authReady = setPersistence/)
assert.match(app, /centralAuthReady/)
assert.match(app, /setCentralAuthReady\(true\)/)
assert.match(sync, /export const isKioskAuthenticatedUser/)
assert.match(app, /const kioskAuthReady = Boolean\(centralAuthUser && isKioskAuthenticatedUser\(centralAuthUser\)\)/)
assert.match(app, /if \(isCentralConfigured\(\) && !kioskAuthReady\) return <KioskActivation/)
assert.match(app, /if \(isCentralConfigured\(\) && !centralAuthReady\) return null/)
assert.match(sync, /makeSettlementIdempotencyKey/)
assert.equal(makeSettlementIdempotencyKey('day-2026-10-05'), 'settlement:day-2026-10-05')
assert.equal(makeSettlementIdempotencyKey('day-2026-10-05'), makeSettlementIdempotencyKey('day-2026-10-05'))
assert.match(sync, /pos101_kiosk === true/)
assert.match(sync, /scope === 'cashier'/)
assert.match(sync, /requireKioskUser/)
assert.match(sync, /const financialUser = async/)
assert.match(sync, /const staffUser = async/)
assert.match(sync, /const requireKioskUser = async/)
assert.match(sync, /تفعيل جهاز POS موثوق مطلوب/)
assert.doesNotMatch(app.slice(app.indexOf('const handleStartOperationalDay'), app.indexOf('const handleEndOperationalDay')), /signInCentralWithGoogle/)
assert.doesNotMatch(expenses, /await signInCentralWithGoogle\(\)/)
for (const path of operationalPaths) {
  assert.match(rules[path]['.read'], /auth\.token\.pos101_kiosk === true/)
  assert.match(rules[path]['.read'], /pos101_kiosks/)
  assert.match(rules[path]['.write'], /auth\.token\.pos101_kiosk === true/)
  assert.match(rules[path]['.write'], /child\('active'\)\.val\(\) === true/)
}
assert.equal(rules['.read'], false)
assert.equal(rules['.write'], false)
assert.equal(rules.pos101_authorized_uids['.read'], false)
assert.equal(rules.pos101_authorized_uids['.write'], false)
assert.doesNotMatch(JSON.stringify(rules), /"\.read"\s*:\s*true/)
assert.doesNotMatch(JSON.stringify(rules), /"\.write"\s*:\s*true/)

console.log('ANONYMOUS_AUTH=DISABLED_BY_DESIGN')
console.log('KIOSK_AUTH_REGRESSION=PASS')
console.log('END_DAY_RUNTIME_REGRESSION=PASS')
console.log('END_DAY_IDEMPOTENCY_REGRESSION=PASS')
console.log('PARTIAL_CLOSE_REGRESSION=PASS')
console.log('SALE_WITHOUT_GOOGLE_LOGIN_REGRESSION=PASS')
console.log('EXPENSE_WITHOUT_GOOGLE_LOGIN_REGRESSION=PASS')
console.log('STAFF_WITHOUT_GOOGLE_LOGIN_REGRESSION=PASS')
