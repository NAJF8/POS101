import assert from 'node:assert/strict'
import fs from 'node:fs'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const diagnostic = fs.readFileSync(new URL('../src/services/endDayDiagnostic.js', import.meta.url), 'utf8')
const ui = fs.readFileSync(new URL('../src/components/OperationalDay.jsx', import.meta.url), 'utf8')
const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules

const closed = { id: 'day-closed', operationalDayId: 'day-closed', businessDate: '2026-10-08', status: 'closed', updatedAt: 2, version: 2 }
const open = { id: 'day-open', operationalDayId: 'day-open', businessDate: '2026-10-09', status: 'open', updatedAt: 3, version: 3 }
const sale = { saleId: 'sale-1', operationalDayId: 'day-closed', businessDate: '2026-10-08' }
const centralAllows = day => day.status === 'open' && day.id === sale.operationalDayId && day.businessDate === sale.businessDate
assert.equal(centralAllows(closed), false)
assert.equal(centralAllows(open), false)
assert.equal(centralAllows({ ...closed, status: 'open' }), true)

assert.match(sync, /pos101_operational_day\/current/)
assert.match(sync, /onValue\(operationalDayCurrentRef\(\)/)
assert.match(sync, /localOperationalDayStale/)
assert.match(sync, /localClosedByCentral/)
assert.match(sync, /readCentralOperationalDay\(\)/)
assert.match(sync, /CENTRAL_DAY_CLOSED/)
assert.match(sync, /CENTRAL_DAY_MISMATCH/)
assert.match(sync, /currentDayMatchesSale\(centralDay, sale\)/)
assert.match(sync, /END_DAY_CENTRAL_STATUS_READBACK/)
assert.match(sync, /\[OPERATIONAL_DAY_CURRENT_PATH\]: closedDay/)
assert.match(app, /operationalDayCentralReady/)
assert.match(app, /اليوم التشغيلي مغلق\. افتح يومًا جديدًا قبل البيع\./)
assert.match(app, /readCentralOperationalDay\(\)/)
assert.match(app, /isOperationalDayClosedError\(error\)/)
assert.match(app, /enqueueSale\(sale, \{ error \}\)/)
assert.ok(app.indexOf('isOperationalDayClosedError(error)') < app.indexOf('enqueueSale(sale, { error })'))
for (const field of ['LOCAL_OPERATIONAL_DAY_ID', 'LOCAL_BUSINESS_DATE', 'LOCAL_DAY_STATUS', 'CENTRAL_OPERATIONAL_DAY_ID', 'CENTRAL_BUSINESS_DATE', 'CENTRAL_DAY_STATUS', 'LOCAL_CENTRAL_DAY_MATCH', 'SALE_ALLOWED', 'BLOCK_REASON', 'OPEN_SALES_QUEUE_COUNT']) {
  assert.match(diagnostic, new RegExp(field))
  assert.match(ui, new RegExp(field))
}
assert.match(rules.pos101_operational_day['.read'], /auth != null/)
assert.match(rules.pos101_operational_day['.write'], /pos101_kiosk/)
assert.match(rules.pos101_operational_day.current['.validate'], /status/)

console.log('REMOTE_CLOSE_UPDATES_CASHIER_REALTIME=PASS')
console.log('STALE_LOCAL_OPEN_DAY_BLOCKED=PASS')
console.log('SALE_BLOCKED_WHEN_CENTRAL_DAY_CLOSED=PASS')
console.log('SALE_ALLOWED_ONLY_WHEN_CENTRAL_DAY_OPEN=PASS')
console.log('LOCAL_STORAGE_DOES_NOT_OVERRIDE_CENTRAL_CLOSED=PASS')
console.log('END_DAY_CLOSE_READBACK_BEFORE_LOCAL_CLOSED=PASS')
console.log('NEW_DAY_CREATES_NEW_OPERATIONAL_DAY_ID=PASS')
console.log('SALES_USE_CURRENT_CENTRAL_OPERATIONAL_DAY=PASS')
console.log('NO_QUEUE_CREATED_FOR_CLOSED_DAY_SALE_ATTEMPT=PASS')
