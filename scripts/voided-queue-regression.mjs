import assert from 'node:assert/strict'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
}
const q = await import(`../src/services/salesSyncQueue.js?voided=${Date.now()}`)
const sale = { saleId: 'void-1', id: 'void-1', operationKey: 'pos101:void-1', status: 'voided', orderNumber: 1321, total: 15000, businessDate: '2026-10-08', operationalDayId: '243e4119-2acb-481e-98e5-78af884f4a05', items: [{ name: 'x', quantity: 1, price: 15000 }] }
values.set('pos101.sales', JSON.stringify([sale]))
values.set('pos101.syncQueue', JSON.stringify([{ kind: 'sale', sale }]))
assert.equal(q.isVoidedSale(sale), true)
assert.equal(q.readSaleQueue().length, 0)
const result = q.resolveVoidedSaleLocally(sale)
const stored = JSON.parse(values.get('pos101.sales'))[0]
assert.equal(result.queueResolution, 'voided_before_central_sync')
assert.equal(stored.centralUploadSkipped, true)
assert.equal(stored.queueResolution, 'voided_before_central_sync')
assert.equal(JSON.parse(values.get('pos101.syncQueue')).length, 0)

console.log(JSON.stringify({
  VOIDED_QUEUE_ITEMS_HANDLED: 'PASS',
  VOIDED_ORDERS_NOT_UPLOADED_AS_ACTIVE: 'PASS',
  VOIDED_QUEUE_NOT_COUNTED_AS_ACTIVE_PENDING: 'PASS',
  AUDIT_MARKER_WRITTEN: 'PASS',
}, null, 2))
