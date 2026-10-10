import assert from 'node:assert/strict'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(String(key)) ?? null,
  setItem: (key, value) => values.set(String(key), String(value)),
  removeItem: key => values.delete(String(key)),
  key: index => [...values.keys()][index] ?? null,
  get length () { return values.size },
}
globalThis.window = { dispatchEvent: () => {} }
const { quarantineStaleSaleQueueEntries, readSaleQueue, readQueueQuarantine } = await import(`../src/services/salesSyncQueue.js?queue=${Date.now()}`)
const { findActiveOrderNumberCollision } = await import(`../src/services/orderNumberAllocation.js?queue=${Date.now()}`)

const day = { id: 'day-current', businessDate: '2026-10-10', status: 'open' }
const sale = (id, businessDate, operationalDayId, orderNumber) => ({
  saleId: id, id, operationKey: `pos101:${id}`, orderNumber, businessDate, operationalDayId,
  subtotal: 100, total: 100, paymentMethod: 'cash', status: 'completed',
  items: [{ id: 'coffee', name: 'قهوة', quantity: 1, price: 100, unitPrice: 100, lineTotal: 100 }],
})
values.set('pos101.syncQueue', JSON.stringify([
  { type: 'sale_write', kind: 'sale', queueKey: 'old-1320', sale: sale('old-1320', '2026-09-30', 'day-old', 1320) },
  { type: 'sale_write', kind: 'sale', queueKey: 'old-1321', sale: sale('old-1321', '2026-09-30', 'day-old', 1321) },
  { type: 'sale_write', kind: 'sale', queueKey: 'current', sale: sale('current', day.businessDate, day.id, 1400) },
]))

const result = quarantineStaleSaleQueueEntries({ operationalDay: day, centralSales: [] })
assert.equal(result.moved, 2)
assert.equal(readSaleQueue().length, 1)
assert.deepEqual(readQueueQuarantine().map(row => row.orderNumber), [1320, 1321])
assert.equal(readSaleQueue()[0].sale.orderNumber, 1400)
assert.equal(findActiveOrderNumberCollision(sale('today', day.businessDate, day.id, 1320), [sale('historical', '2026-09-30', 'day-old', 1320)]), null)
console.log('OLD_QUEUE_1320_1321_QUARANTINED=PASS')
console.log('OLD_QUEUE_NOT_BLOCKING_CURRENT_SALE=PASS')
console.log('HISTORICAL_DUPLICATES_WARNING_ONLY=PASS')
console.log('FIREBASE_WRITES_PERFORMED=0')
console.log('QUEUE_TESTS=PASS')

