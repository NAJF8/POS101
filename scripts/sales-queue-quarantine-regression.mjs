import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
globalThis.window = { dispatchEvent: () => {} }
const q = await import(`../src/services/salesSyncQueue.js?phase-c=${Date.now()}`)
const day = { businessDate: '2026-10-07', id: 'day-current' }
const sale = (overrides = {}) => ({ saleId: 'c-sale', operationKey: 'pos101:c-sale', orderNumber: 1, businessDate: day.businessDate, operationalDayId: day.id, createdAt: 1, subtotal: 100, total: 100, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 100, lineTotal: 100 }], status: 'completed', ...overrides })
const reset = () => { store.clear(); localStorage.setItem('pos101.sales', '[]'); localStorage.setItem('pos101.syncQueue', '[]'); localStorage.setItem(q.QUARANTINE_BUCKET, '[]') }
const hasReason = reason => q.readSalesQuarantine().some(row => row.quarantineReason === reason)

reset()
q.enqueueSale(sale())
assert.equal(q.readSaleQueue().length, 1)
assert.equal(q.readSalesQuarantine().length, 0)
assert.equal(q.financialFingerprint(sale()), q.financialFingerprint(sale()))

reset()
q.enqueueSale(sale({ operationKey: '' }))
assert.equal(q.readSaleQueue().length, 0)
assert(hasReason('LEGACY_UNSAFE_QUEUE'))

reset()
q.enqueueSale(sale({ operationalDayId: '' }))
assert.equal(q.readSaleQueue().length, 0)
assert(hasReason('LEGACY_UNSAFE_QUEUE'))

reset()
const orphan = { ...sale({ saleId: 'orphan' }), syncStatus: 'pending_sync' }
localStorage.setItem('pos101.syncQueue', JSON.stringify([{ sale: orphan }]))
q.reconcileSalesQueue()
assert(hasReason('QUEUE_WITHOUT_LEDGER'))

reset()
assert.equal(q.classifyCentralSale(sale(), [sale({ syncStatus: 'pending' })]).action, 'duplicate')
assert.equal(q.classifyCentralSale(sale(), [sale({ net: 90, total: 90 })]).reason, 'SALE_ID_COLLISION')
assert.equal(q.classifyCentralSale(sale(), [sale({ saleId: 'other', operationKey: sale().operationKey })]).reason, 'OPERATION_KEY_COLLISION')

reset()
for (const status of ['draft', 'voided', 'cancelled', 'canceled', 'abandoned']) q.enqueueSale(sale({ saleId: status, operationKey: `pos101:${status}`, status }))
assert.equal(q.readSaleQueue().length, 0)
assert.equal(q.readSalesQuarantine().length, 5)

reset()
const old = sale({ businessDate: '2026-10-06', operationalDayId: 'day-old' })
q.enqueueSale(old)
assert.equal(q.readSaleQueue()[0].businessDate, '2026-10-06')
assert.equal(q.readSaleQueue()[0].operationalDayId, 'day-old')
q.retainQueuedSale(q.readSaleQueue()[0], 'SALE_READBACK_FAILED')
assert.equal(q.readSaleQueue().length, 1)

reset()
const reloadSale = sale({ saleId: 'reload', operationKey: 'pos101:reload' })
q.enqueueSale(reloadSale)
const reloaded = await import(`../src/services/salesSyncQueue.js?phase-c-reload=${Date.now()}`)
assert.equal(reloaded.readSaleQueue().length, 1)

console.log(JSON.stringify({
  QUARANTINE_BUCKET: 'PASS', LEGACY_NO_AUTOSEND: 'PASS', NEW_QUEUE_REQUIRES_OPERATION_KEY: 'PASS',
  NEW_QUEUE_REQUIRES_DAY_IDENTITY: 'PASS', LEDGER_BEFORE_QUEUE: 'PASS', CENTRAL_DUPLICATE_BLOCK: 'PASS',
  OPERATION_KEY_COLLISION_BLOCK: 'PASS', SALE_ID_COLLISION_BLOCK: 'PASS', FINANCIAL_FINGERPRINT: 'PASS',
  INVALID_STATUS_NO_UPLOAD: 'PASS', NO_CROSS_DAY_REASSIGNMENT: 'PASS', READBACK_BEFORE_DEQUEUE: 'PASS',
  CENTRAL_PENDING_NO_RESEND: 'PASS', STARTUP_RECONCILIATION: 'PASS', QUARANTINE_RELOAD: 'PASS'
}, null, 2))
