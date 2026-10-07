import assert from 'node:assert/strict'
import { reconcilePreCloseSales } from '../src/services/preCloseReconciliation.js'
import { compareReportSalesToSettlement } from '../src/services/reportSales.js'

const day = { id: 'open-day-1', businessDate: '2026-10-07', status: 'open' }
const sale = id => ({ id, operationKey: `op-${id}`, operationalDayId: day.id, businessDate: day.businessDate, total: 100, items: [{ name: 'coffee', quantity: 1 }], status: 'completed' })
const central10 = Array.from({ length: 10 }, (_, index) => sale(`sale-${index}`))
const local11 = [...central10, sale('sale-10')]
const pending = [{ sale: sale('sale-10'), status: 'pending' }]

const blocked = reconcilePreCloseSales({ localSales: local11, queueEntries: pending, centralSales: central10, operationalDay: day })
assert.equal(blocked.allowed, false)
assert.equal(blocked.pendingQueue, 1)
assert.equal(blocked.missingLocal.length, 1)

const allowed = reconcilePreCloseSales({ localSales: local11, queueEntries: [], centralSales: local11, operationalDay: day })
assert.equal(allowed.allowed, true)
assert.equal(allowed.pendingQueue, 0)

const cancelled = reconcilePreCloseSales({ localSales: [...local11, { ...sale('cancelled'), status: 'cancelled' }], queueEntries: [{ sale: { ...sale('draft'), status: 'draft' } }], centralSales: local11, operationalDay: day })
assert.equal(cancelled.allowed, true)

const drift = compareReportSalesToSettlement({ sales: local11, settlement: { orderCount: 10, sales: 1000 } })
assert.equal(drift.drift, true)
assert.equal(compareReportSalesToSettlement({ sales: local11, settlement: { orderCount: 11, sales: 1100 } }).drift, false)
console.log('PRE_CLOSE_RECONCILIATION_REGRESSION=PASS')
console.log('UNSYNCED_SALE_BLOCKS_CLOSE=PASS')
console.log('PENDING_QUEUE_BLOCKS_CLOSE=PASS')
console.log('POST_CLOSE_DRIFT_DETECTED=PASS')
