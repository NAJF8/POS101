import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const header = read('src/components/Header.jsx')
const dashboard = read('src/components/Dashboard.jsx')
const operationalDay = read('src/components/OperationalDay.jsx')
const worker = read('src/services/cashierQueueWorker.js')
const sync = read('src/services/posCentralSync.js')
const queue = read('src/services/salesSyncQueue.js')
const engine = read('src/services/saleEngine.js')

assert.doesNotMatch(header, /مزامنة الآن/)
assert.doesNotMatch(header, /onSync/)
assert.match(operationalDay, /canViewDiagnostics = false/)
assert.match(dashboard, /canViewDiagnostics=\{canViewDiagnostics\}/)
assert.match(app, /canViewDiagnostics=\{adminReady\}/)
assert.match(operationalDay, /فحص المزامنة/)
assert.match(app, /saleEngine\.sell\(/)
assert.match(engine, /saveCentralSaleImmediately/)
assert.ok(app.indexOf('saleEngine.sell(') < app.indexOf('requestSalePrint(result.sale)'))
assert.match(app, /await voidCentralSaleImmediately\(pending/)
assert.match(app, /setCashierSyncPhase\('saving'\)/)
assert.match(app, /تم تثبيت الطلب/)
assert.match(app, /تم تثبيت الإبطال/)
assert.match(app, /سيُعاد رفعه تلقائيًا/)
assert.match(worker, /intervalMs = 10000/)
assert.match(app, /'online'/)
assert.match(app, /'auth-ready'/)
assert.match(app, /'firebase-reconnect'/)
assert.match(sync, /const readBack = await get\(saleRef\)/)
assert.match(queue, /export const enqueueSale/)
assert.match(queue, /export const enqueueVoidUpdate/)
assert.match(operationalDay, /توجد عملية غير مكتملة، سيتم المحاولة تلقائيًا/)

console.log(JSON.stringify({
  CASHIER_SYNC_BUTTONS_HIDDEN: 'PASS',
  CASHIER_DIAGNOSTICS_HIDDEN: 'PASS',
  ADMIN_DIAGNOSTICS_AVAILABLE: 'PASS',
  AUTO_SALE_SYNC_STILL_CENTRAL_FIRST: 'PASS',
  AUTO_VOID_SYNC_STILL_CENTRAL_FIRST: 'PASS',
  READBACK_BEFORE_PRINT: 'PASS',
  EMERGENCY_QUEUE_AUTO_RETRY: 'PASS',
  END_DAY_BLOCKS_PENDING_WITH_SIMPLE_MESSAGE: 'PASS',
}))
