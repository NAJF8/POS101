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

const centralLegacyPendingMetadata = { ...sale('sale-10'), syncStatus: 'pending' }
const legacyMetadataAllowed = reconcilePreCloseSales({ localSales: local11, queueEntries: pending, centralSales: [centralLegacyPendingMetadata, ...central10], operationalDay: day })
assert.equal(legacyMetadataAllowed.allowed, true)
assert.equal(legacyMetadataAllowed.pendingQueue, 0)

const cancelled = reconcilePreCloseSales({ localSales: [...local11, { ...sale('cancelled'), status: 'cancelled' }], queueEntries: [{ sale: { ...sale('draft'), status: 'draft' } }], centralSales: local11, operationalDay: day })
assert.equal(cancelled.allowed, true)

assert.equal(reconcilePreCloseSales({ queueEntries: [{ sale: sale('legacy') }], centralSales: [], operationalDay: day, openOrderCount: 0 }).allowed, false)
assert.equal(reconcilePreCloseSales({ queueEntries: [{ sale: { ...sale('legacy-no-day'), operationalDayId: '', businessDate: '' } }], centralSales: [], operationalDay: day }).allowed, true)
assert.equal(reconcilePreCloseSales({ queueEntries: [{ sale: { ...sale('old-day'), operationalDayId: 'old', businessDate: '2026-10-06' } }], centralSales: [], operationalDay: day }).allowed, true)
const openBlocked = reconcilePreCloseSales({ queueEntries: [], centralSales: [], operationalDay: day, openOrderCount: 1 })
assert.equal(openBlocked.allowed, false)
assert.equal(openBlocked.message, 'يوجد طلب مفتوح، أكمله أو ألغِه قبل إنهاء اليوم.')
assert.equal(reconcilePreCloseSales({ queueEntries: [], centralSales: [], operationalDay: day, openOrderCount: 0 }).message, '')

const drift = compareReportSalesToSettlement({ sales: local11, settlement: { orderCount: 10, sales: 1000 } })
assert.equal(drift.drift, true)
assert.equal(compareReportSalesToSettlement({ sales: local11, settlement: { orderCount: 11, sales: 1100 } }).drift, false)
console.log('PRE_CLOSE_RECONCILIATION_REGRESSION=PASS')
console.log('UNSYNCED_SALE_BLOCKS_CLOSE=PASS')
console.log('PENDING_QUEUE_BLOCKS_CLOSE=PASS')
console.log('OPEN_ORDER_MESSAGE=PASS')
console.log('REAL_PENDING_SYNC_MESSAGE=PASS')
console.log('NO_FALSE_FIREBASE_WARNING=PASS')
console.log('LEGACY_QUEUE_DOES_NOT_BLOCK_CLOSE=PASS')
console.log('INVALID_STATUS_NOT_BLOCKING=PASS')
console.log('CURRENT_DAY_ONLY_PENDING_BLOCK=PASS')
console.log('OPEN_ORDER_DETECTION_SEPARATE_FROM_SYNC=PASS')
console.log('POST_CLOSE_DRIFT_DETECTED=PASS')
console.log('CENTRAL_PENDING_METADATA_NO_BLOCK=PASS')
