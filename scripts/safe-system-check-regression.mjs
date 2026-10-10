import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const service = await import('../src/services/safeSystemCheck.js')

assert.equal(service.safeJsonParse('{bad', 'fallback'), 'fallback')
assert.equal(service.safeText('  ok  '), 'ok')
assert.equal(service.safeNumber('bad', 7), 7)
assert.match(service.safeFormatMoney(1200), /1,?200|١٬٢٠٠/)
assert.match(service.safeErrorMessage({ code: 'TEST', message: `bearer ${'x'.repeat(60)}` }), /redacted/)
assert.deepEqual(service.safeObjectSummary([1, 2]), { type: 'array', length: 2 })

const checks = await service.runIndependentChecks([
  ['pass', async () => ({ status: 'pass', message: 'ok' })],
  ['malformed-json', async () => { service.safeJsonParse('{bad'); return { status: 'warn', message: 'handled' } }],
  ['firebase-read-failure', async () => { throw Object.assign(new Error('permission denied'), { code: 'PERMISSION_DENIED' }) }],
  ['after-failure', async () => ({ status: 'pass', message: 'continued' })],
])
assert.equal(checks.length, 4)
assert.equal(checks[2].status, 'fail')
assert.equal(checks[3].status, 'pass')

const app = read('src/App.jsx')
const header = read('src/components/Header.jsx')
const serviceSource = read('src/services/safeSystemCheck.js')
const component = read('src/components/SafeSystemCheck.jsx')
assert.match(app, /runSafeSystemCheck/)
assert.match(header, /فحص وإصلاح النظام|SafeSystemCheck/)
assert.match(component, /data-testid="safe-system-check-button"/)
assert.match(serviceSource, /readCentralExpensesForReports\(\{ persistCache: false, dispatchUpdate: false \}\)/)
for (const forbidden of ['markSaleSynced', 'saveCentralSaleImmediately', 'enqueueSale', 'removeItem', 'localStorage.clear']) assert.equal(serviceSource.includes(forbidden), false, `safe service contains forbidden write: ${forbidden}`)
assert.match(serviceSource, /firebaseWrites: 0/)
console.log('SAFE_SYSTEM_CHECK_REGRESSION=PASS')
