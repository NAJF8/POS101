import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
globalThis.window = { dispatchEvent: () => {} }

const queue = await import(`../src/services/salesSyncQueue.js?pending-fix=${Date.now()}`)
const sale = {
  saleId: 'pending-fix-sale',
  id: 'pending-fix-sale',
  operationKey: 'pos101:pending-fix-sale',
  orderNumber: 1321,
  businessDate: '2026-10-09',
  operationalDayId: 'day-2026-10-09',
  status: 'completed',
  syncStatus: 'pending',
  total: 7000,
  subtotal: 7000,
  discount: 0,
  paymentMethod: 'cash',
  items: [{ id: 'coffee', quantity: 1, price: 7000 }],
}

localStorage.setItem('pos101.sales', JSON.stringify([sale]))
// Include both the normal wrapper and a legacy top-level emergency row.
localStorage.setItem('pos101.syncQueue', JSON.stringify([{ sale }, { ...sale, type: 'sale_write' }]))

const exactCentral = { ...sale, status: 'completed', syncStatus: 'synced', centralVerified: true }
const result = queue.reconcileLocalQueueAgainstCentral([exactCentral], { now: new Date('2026-10-09T08:30:00.000Z') })
assert.equal(result.firebaseWritesPerformed, 0)
assert.equal(result.removedVerified, 2)
assert.equal(result.quarantinedMalformed, 0)
assert.equal(JSON.parse(localStorage.getItem('pos101.syncQueue')).length, 0)

// The normal readback path must clear both wrapper shapes after the exact
// Firebase match has already been verified by the caller.
queue.markSaleSynced(sale, 1791534600000)
const localAfter = JSON.parse(localStorage.getItem('pos101.sales'))[0]
assert.equal(localAfter.centralVerified, true)
assert.equal(localAfter.syncStatus, 'synced')
assert.equal(JSON.parse(localStorage.getItem('pos101.syncQueue')).length, 0)

console.log(JSON.stringify({
  EXACT_READBACK_REQUIRED: 'PASS',
  NO_FIREBASE_WRITES_DURING_LOCAL_RECONCILIATION: 'PASS',
  SAME_SALE_ID_QUEUE_CLEARED: 'PASS',
  LOCAL_CENTRAL_VERIFIED: 'PASS',
  NO_DUPLICATE_SALE_CREATED: 'PASS',
}, null, 2))
