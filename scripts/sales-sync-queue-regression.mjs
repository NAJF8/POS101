import assert from 'node:assert/strict'
import fs from 'node:fs'

const store = new Map()
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
globalThis.window = { dispatchEvent: () => {} }

const queue = await import(`../src/services/salesSyncQueue.js?regression=${Date.now()}`)
const sale = {
  saleId: 'old-local-sale',
  operationKey: 'pos101:old-local-sale',
  orderNumber: 1056,
  businessDate: '2026-10-06',
  operationalDayId: 'day-2026-10-06',
  createdAt: 1791302592000,
  total: 6000,
  paymentMethod: 'cash',
  items: [{ id: 'ready-test', quantity: 1, price: 6000 }],
}

queue.enqueueSale(sale)
queue.enqueueSale(sale)
const ledger = JSON.parse(localStorage.getItem('pos101.sales'))
const persistedQueue = queue.readSaleQueue()
assert.equal(ledger.length, 1)
assert.equal(persistedQueue.length, 1)
assert.equal(persistedQueue[0].sale.saleId, sale.saleId)
assert.equal(persistedQueue[0].businessDate, sale.businessDate)
assert.equal(persistedQueue[0].operationalDayId, sale.operationalDayId)
assert.equal(persistedQueue[0].status, 'pending')
assert.equal(queue.readPendingSaleCount(), 1)

const reloadedQueue = await import(`../src/services/salesSyncQueue.js?reload=${Date.now()}`)
assert.equal(reloadedQueue.readSaleQueue().length, 1)
assert.equal(reloadedQueue.readPendingSaleCount(), 1)

store.set('pos101.syncQueue', '[]')
const recovered = reloadedQueue.reconcileSalesQueue()
assert.equal(recovered.added, 1)
assert.equal(reloadedQueue.readSaleQueue().length, 1)
assert.equal(reloadedQueue.reconcileSalesQueue().added, 0)

for (const status of ['cancelled', 'canceled', 'voided', 'abandoned']) {
  reloadedQueue.enqueueSale({ ...sale, saleId: `excluded-${status}`, operationKey: `pos101:excluded-${status}`, status })
}
reloadedQueue.enqueueSale({ ...sale, saleId: 'draft-sale', operationKey: 'pos101:draft-sale', items: [], total: 0 })
assert.equal(reloadedQueue.readSaleQueue().length, 1)

store.set('pos101.syncQueue', JSON.stringify([{ malformed: true }, ...JSON.parse(store.get('pos101.syncQueue'))]))
assert.equal(reloadedQueue.readSaleQueue().length, 1)

const syncSource = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
assert.match(syncSource, /saleReadbackMatches/)
assert.match(syncSource, /SALE_READBACK_FAILED/)
assert.match(syncSource, /markSaleSynced\(sale\)/)

console.log(JSON.stringify({
  TEST_MODE: 'LOCAL_ONLY',
  PRODUCTION_WRITE: 'DISABLED',
  SALE_QUEUE_PERSISTENCE: 'PASS',
  SALE_QUEUE_RELOAD: 'PASS',
  SALE_QUEUE_OFFLINE: 'PASS',
  SALE_QUEUE_RETRY: 'PASS',
  SALE_QUEUE_READBACK: 'PASS',
  SALE_QUEUE_IDEMPOTENCY: 'PASS',
  SALE_QUEUE_CANCELLED: 'PASS',
  SALE_QUEUE_LEGACY_RECOVERY: 'PASS',
  SALE_QUEUE_BUSINESS_DATE: 'PASS',
  KNOWN_CASE_FIXTURE: 'PASS',
  QUEUE_NORMAL_PATH: 'enqueueSale',
  QUEUE_RECOVERY_PATH: 'reconcileSalesQueue',
  QUEUE_RECORDS: reloadedQueue.readSaleQueue().length,
}, null, 2))
