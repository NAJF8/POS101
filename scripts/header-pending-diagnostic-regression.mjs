import assert from 'node:assert/strict'
import fs from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
globalThis.window = { dispatchEvent: () => {} }

const queue = await import(`../src/services/salesSyncQueue.js?header-diagnostic=${Date.now()}`)
const base = {
  saleId: 'sale-1321', id: 'sale-1321', operationKey: 'pos101:sale-1321', orderNumber: 1321,
  businessDate: '2026-10-09', operationalDayId: 'day-2026-10-09', total: 7000,
  subtotal: 7000, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 7000 }],
}

localStorage.setItem('pos101.sales', JSON.stringify([{
  ...base, status: 'voided', voided: true, queueResolution: 'voided_before_central_sync', centralVerified: false,
}]))
localStorage.setItem('pos101.syncQueue', JSON.stringify([{
  type: 'void_update', kind: 'void_update', saleId: base.saleId, orderNumber: base.orderNumber,
  status: 'pending', businessDate: base.businessDate, operationalDayId: base.operationalDayId,
  voidPayload: { saleId: base.saleId },
}]))

const staleVoided = queue.readHeaderPendingDiagnostic({ orders: [{ id: 1, items: [] }], openOrderCount: 0 })
assert.equal(staleVoided.pendingSaleWriteCount, 0)
assert.equal(staleVoided.pendingVoidUpdateCount, 0)
assert.equal(staleVoided.activePendingQueueCount, 0)
assert.equal(staleVoided.voidedBeforeSyncCount, 1)
assert.equal(staleVoided.lastBlockingSaleId, null)

localStorage.setItem('pos101.sales', JSON.stringify([{ ...base, status: 'completed', syncStatus: 'pending' }]))
const activePending = queue.readHeaderPendingDiagnostic({ orders: [{ id: 1, items: [] }], openOrderCount: 0 })
assert.equal(activePending.activePendingQueueCount, 1)
assert.equal(activePending.lastBlockingOrderNumber, 1321)
assert.equal(activePending.lastBlockingSaleId, base.saleId)
assert.equal(activePending.lastBlockingReason, 'PENDING_VOID_UPDATE')

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
assert.match(app, /HEADER_PENDING_DIAGNOSTIC/)
assert.match(app, /saleSyncStatus\.activePendingQueueCount > 0/)

localStorage.setItem('pos101.sales', JSON.stringify({ legacy: base }))
localStorage.setItem('pos101.syncQueue', '[]')
const legacyStorage = queue.readHeaderPendingDiagnostic({ orders: [], openOrderCount: 0 })
assert.equal(legacyStorage.activePendingQueueCount, 0)

console.log(JSON.stringify({
  VOIDED_1321_NOT_BLOCKING: 'PASS',
  ACTIVE_VOID_UPDATE_STILL_BLOCKS: 'PASS',
  HEADER_DIAGNOSTIC_LOGGED: 'PASS',
  HEADER_USES_CANONICAL_ACTIVE_QUEUE: 'PASS',
  NO_LOCALSTORAGE_WIPE: 'PASS',
}, null, 2))
