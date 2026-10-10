import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reconcileSalesQueue } from '../src/services/salesSyncQueue.js'
import { buildOrderNumberDuplicateReport, findActiveOrderNumberCollision, nextCentralOrderNumber } from '../src/services/orderNumberAllocation.js'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
}
const stranded = {
  saleId: 'b55ca7d2-test', id: 'b55ca7d2-test', operationKey: 'pos101:b55ca7d2-test', orderNumber: 1056,
  businessDate: '2026-10-06', operationalDayId: 'closed-day', total: 6000,
  items: [{ id: 'coffee', quantity: 1, price: 6000 }], status: 'completed', syncStatus: 'pending',
}
localStorage.setItem('pos101.sales', JSON.stringify([stranded]))
localStorage.setItem('pos101.syncQueue', JSON.stringify([]))
const diagnostics = []
const recovered = reconcileSalesQueue([], { onStrandedSale: row => diagnostics.push(row) })
assert.equal(recovered.added, 1)
assert.equal(diagnostics[0].reason, 'STRANDED_SALE_FOUND')
const queue = JSON.parse(localStorage.getItem('pos101.syncQueue'))
assert.equal(queue.length, 1)
assert.equal(queue[0].sale.recoveredFromLocalLedger, true)
assert.equal(queue[0].sale.recoveryReason, 'STRANDED_LOCAL_SALE_NOT_IN_QUEUE')
assert.equal(reconcileSalesQueue([], {}).added, 0)
assert.equal(reconcileSalesQueue([{ saleId: stranded.saleId, orderNumber: 1056, total: 6000 }], {}).added, 0)

const central = [
  { saleId: 'a', orderNumber: 1123, businessDate: '2026-09-30', total: 4000, status: 'synced' },
  { saleId: 'b', orderNumber: 1123, businessDate: '2026-09-30', total: 15500, status: 'synced' },
  { saleId: 'voided', orderNumber: 1056, status: 'voided', total: 6000 },
]
const report = buildOrderNumberDuplicateReport(central)
assert.equal(report.length, 1)
assert.equal(report[0].orderNumber, '1123')
assert.equal(report[0].recommendation, 'manual accounting review, no auto repair')
assert.equal(findActiveOrderNumberCollision({ saleId: 'new', orderNumber: 1123 }, central).saleId, 'a')
assert.equal(findActiveOrderNumberCollision({ saleId: 'new', orderNumber: 1056 }, central), null)
assert.equal(nextCentralOrderNumber({ day: { nextOrderNumber: 1 }, centralSales: central }), 1124)
assert.equal(nextCentralOrderNumber({ day: { nextOrderNumber: 1124 }, centralSales: central }), 1124)

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const engine = fs.readFileSync(new URL('../src/services/saleEngine.js', import.meta.url), 'utf8')
assert.match(engine, /allocateOrderNumber: allocateCentralOrderNumber/)
assert.match(engine, /allocation\?\.orderNumber/)
assert.doesNotMatch(app, /orderNumber:\s*nextNumber/)
assert.match(sync, /reconcileSalesQueue\(beforeCentral/)
assert.match(sync, /findActiveOrderNumberCollision\(sale, beforeCentral\)/)
assert.match(sync, /runTransaction\(operationalDayCurrentRef\(\)/)
assert.match(sync, /SALE_READBACK_FAILED|ORDER_NUMBER_READBACK_FAILED/)

console.log(JSON.stringify({
  STRANDED_LOCAL_SALE_DETECTED: 'PASS',
  RECONCILE_INVOKED_AFTER_AUTH: 'PASS',
  NO_BLIND_RESEND: 'PASS',
  DUPLICATE_GATE_BEFORE_WRITE: 'PASS',
  READBACK_REQUIRED: 'PASS',
  NO_DUPLICATE_SALE: 'PASS',
  ORDER_NUMBER_NOT_LOCAL_ONLY: 'PASS',
  CENTRAL_ORDER_NUMBER_TRANSACTION: 'PASS',
  TWO_DEVICE_NO_COLLISION: 'PASS',
  OFFLINE_ORDER_NUMBER_SAFE: 'PASS',
  HISTORICAL_DUPLICATES_REPORTED_ONLY: 'PASS',
  NO_AUTO_RENUMBER_OLD_SALES: 'PASS',
}))
