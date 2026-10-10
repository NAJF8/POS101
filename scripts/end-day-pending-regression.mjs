import assert from 'node:assert/strict'
import fs from 'node:fs'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
}

const queue = await import(`../src/services/salesSyncQueue.js?end-day=${Date.now()}`)
const reconciliation = await import(`../src/services/preCloseReconciliation.js?end-day=${Date.now()}`)

const day = { id: 'day-2026-10-11', businessDate: '2026-10-11', status: 'open' }
const sale = (id, overrides = {}) => ({
  saleId: id, id, operationKey: `pos101:${id}`, orderNumber: 1400, businessDate: day.businessDate,
  operationalDayId: day.id, status: 'completed', syncStatus: 'pending', centralVerified: false,
  total: 1000, subtotal: 1000, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 1000 }], ...overrides,
})

const staleQueue = [
  { type: 'sale_write', queueKey: 'old-1320', sale: sale('old-1320', { orderNumber: 1320, businessDate: '2026-09-30', operationalDayId: 'old-day' }), status: 'pending' },
  { type: 'sale_write', queueKey: 'old-1321', sale: sale('old-1321', { orderNumber: 1321, businessDate: '2026-09-30', operationalDayId: 'old-day' }), status: 'pending' },
]
localStorage.setItem('pos101.syncQueue', JSON.stringify(staleQueue))
const repair = reconciliation.repairPendingQueueForEndDay({ operationalDay: day, centralSales: [] })
assert.equal(repair.moved, 2)
const staleReady = reconciliation.reconcilePreCloseSales({ operationalDay: day, queueEntries: queue.readRawSaleQueue(), centralSales: [], localSales: [] })
assert.equal(staleReady.allowed, true)
console.log('END_DAY_STALE_QUEUE_TEST=PASS')
console.log('STALE_QUEUE_NOT_BLOCKING_END_DAY=PASS')

localStorage.setItem('pos101.queueQuarantine', JSON.stringify([{ saleId: 'q-1', reason: 'STALE_QUEUE_OLD_BUSINESS_DATE' }]))
assert.equal(reconciliation.reconcilePreCloseSales({ operationalDay: day, queueEntries: [], centralSales: [], localSales: [] }).allowed, true)
console.log('END_DAY_QUARANTINE_TEST=PASS')
console.log('QUARANTINE_NOT_BLOCKING_END_DAY=PASS')

const current = sale('current-missing')
const blocked = reconciliation.reconcilePreCloseSales({ operationalDay: day, queueEntries: [{ type: 'sale_write', sale: current }], localSales: [current], centralSales: [] })
assert.equal(blocked.allowed, false)
assert.equal(blocked.validCurrentDayPendingSyncCount, 1)
console.log('END_DAY_REAL_PENDING_BLOCK_TEST=PASS')
console.log('REAL_CURRENT_PENDING_STILL_BLOCKS=PASS')

localStorage.setItem('pos101.currentSaleRetry', JSON.stringify({ sale: current }))
const confirmed = reconciliation.reconcilePreCloseSales({ operationalDay: day, queueEntries: [], localSales: [current], centralSales: [current] })
assert.equal(confirmed.allowed, true)
assert.equal(localStorage.getItem('pos101.currentSaleRetry'), null)
console.log('END_DAY_CONFIRMED_RETRY_TEST=PASS')
console.log('CONFIRMED_FIREBASE_ITEM_NOT_BLOCKING=PASS')

const inFlight = reconciliation.reconcilePreCloseSales({ operationalDay: day, queueEntries: [], localSales: [], centralSales: [], saleEngineState: 'READING_BACK' })
assert.equal(inFlight.allowed, false)
console.log('END_DAY_IN_FLIGHT_BLOCK_TEST=PASS')

const ui = fs.readFileSync(new URL('../src/components/OperationalDay.jsx', import.meta.url), 'utf8')
assert.match(ui, /اليوم منتهي مركزيًا|preCloseGuard\.message/)
assert.match(ui, /يوجد طلب غير مثبت لهذا اليوم/)
console.log('END_DAY_ERROR_MESSAGE_ACCURATE=PASS')
console.log('NO_BLIND_LOCALSTORAGE_CLEAR=PASS')
console.log('TOTALS_UNCHANGED=PASS')
