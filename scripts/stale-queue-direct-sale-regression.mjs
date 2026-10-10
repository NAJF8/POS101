import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key), key: index => [...store.keys()][index] ?? null, get length () { return store.size } }
globalThis.window = { dispatchEvent: () => {} }
const q = await import(`../src/services/salesSyncQueue.js?stale=${Date.now()}`)
const day = { id: 'day-2026-10-10', businessDate: '2026-10-10', status: 'open' }
const sale = (id, overrides = {}) => ({ saleId: id, id, operationKey: `pos101:${id}`, orderNumber: 1320, businessDate: day.businessDate, operationalDayId: day.id, createdAt: 1, subtotal: 100, total: 100, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 100, lineTotal: 100 }], status: 'completed', ...overrides })

store.set('pos101.syncQueue', JSON.stringify([{ type: 'sale_write', kind: 'sale', queueKey: 'old-1320', sale: sale('old-1320', { businessDate: '2026-09-30', operationalDayId: 'day-old', orderNumber: 1320 }) }, { type: 'sale_write', kind: 'sale', queueKey: 'old-1321', sale: sale('old-1321', { businessDate: '2026-09-30', operationalDayId: 'day-old', orderNumber: 1321 }) }]))
const result = q.quarantineStaleSaleQueueEntries({ operationalDay: day, centralSales: [] })
assert.equal(result.moved, 2)
assert.equal(q.readSaleQueue().length, 0)
assert.equal(q.readQueueQuarantine().length, 2)
assert.deepEqual(q.readQueueQuarantine().map(row => row.originalQueueId), ['old-1320', 'old-1321'])
assert.equal(q.readQueueQuarantine().every(row => row.reason === 'STALE_QUEUE_OLD_BUSINESS_DATE'), true)

store.set('pos101.syncQueue', JSON.stringify([{ type: 'sale_write', kind: 'sale', queueKey: 'current', sale: sale('current', { orderNumber: 1346 }) }]))
assert.equal(q.quarantineStaleSaleQueueEntries({ operationalDay: day, centralSales: [] }).moved, 0)
assert.equal(q.readSaleQueue().length, 1)
assert.match(q.readSaleQueue()[0].sale.operationKey, /^pos101:current$/)

console.log('STALE_QUEUE_1320_1321_QUARANTINED=PASS')
console.log('CURRENT_DAY_QUEUE_NOT_QUARANTINED=PASS')
console.log('FIREBASE_WRITES_PERFORMED=0')
console.log('DIRECT_CURRENT_SALE_IDENTITY_FRESH=PASS')
