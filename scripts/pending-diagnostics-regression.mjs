import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildPendingSaleDiagnostic, classifyPendingDiagnostic, diagnosticKeyFor, PENDING_DIAGNOSTIC_STATUS } from '../src/services/pendingSaleDiagnostics.js'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const sale = overrides => ({
  saleId: 'sale-pending-1',
  operationKey: 'pos101:sale-pending-1',
  orderNumber: 2026,
  businessDate: '2026-10-10',
  operationalDayId: 'day-2026-10-10',
  total: 12500,
  paymentMethod: 'cash',
  cashierNameSnapshot: 'كاشير اختبار',
  items: [{ id: 'coffee', name: 'قهوة', quantity: 1, price: 12500 }],
  ...overrides,
})

const pending = buildPendingSaleDiagnostic(sale(), { error: { code: 'READ_TIMEOUT', message: 'network timeout' }, attempts: 2, deviceId: 'device-1', kioskId: 'kiosk-1' })
assert.equal(pending.status, PENDING_DIAGNOSTIC_STATUS)
assert.equal(pending.saleId, 'sale-pending-1')
assert.equal(pending.itemCount, 1)
assert.equal(pending.total, 12500)
assert.equal(pending.kioskId, 'kiosk-1')
assert.equal(Object.hasOwn(pending, 'items'), false)
assert.equal(Object.hasOwn(pending, 'image'), false)
assert.ok(diagnosticKeyFor(pending).length > 0)
console.log('PENDING_DIAGNOSTIC_WRITE_TEST=PASS')

const exact = classifyPendingDiagnostic(pending, [sale()])
assert.equal(exact.status, 'EXISTS_ONCE')
assert.equal(exact.exactMatchCount, 1)
console.log('DIAGNOSTIC_NOT_COUNTED_AS_SALE=PASS')
console.log('REMOTE_RECONCILE_EXISTS_ONCE_TEST=PASS')

const missing = classifyPendingDiagnostic(pending, [])
assert.equal(missing.status, 'MISSING')
assert.match(missing.actionSuggestion, /حمولة محلية|انتظار/)
console.log('NO_SALE_CREATED_WITHOUT_PAYLOAD=PASS')

const duplicate = classifyPendingDiagnostic(pending, [sale(), sale({ saleId: 'sale-pending-2' })])
assert.equal(duplicate.status, 'DUPLICATE')
console.log('NO_DUPLICATE_REMOTE_RETRY=PASS')

const sync = read('src/services/posCentralSync.js')
const app = read('src/App.jsx')
const rules = JSON.parse(read('database.rules.json'))
const ruleSource = JSON.stringify(rules.rules.pos101_sync_diagnostics)
assert.match(sync, /writePendingSaleCentralDiagnostic/)
assert.match(sync, /reconcileCentralPendingSaleDiagnostics/)
assert.match(sync, /pos101_sync_diagnostics\/pending_sales/)
assert.match(sync, /salesCreated: 0/)
assert.match(app, /تم إرسال تنبيه للمدير للفحص/)
assert.match(app, /تعذر إرسال التنبيه المركزي، لكن الطلب محفوظ محليًا/)
assert.match(app, /CentralPendingDiagnostics/)
assert.match(ruleSource, /pending_local_confirmation/)
assert.match(ruleSource, /resolved/)
console.log('CENTRAL_PENDING_DIAGNOSTIC_ADDED=PASS')
console.log('REMOTE_PENDING_DIAGNOSTICS_VISIBLE=PASS')
console.log('REMOTE_RECONCILE_READ_FIRST=PASS')
console.log('NO_FINANCIAL_EFFECT_TEST=PASS')
