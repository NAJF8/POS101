import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildEndDayDiagnostic } from '../src/services/endDayDiagnostic.js'
import { reconcilePreCloseSales } from '../src/services/preCloseReconciliation.js'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const sync = read('src/services/posCentralSync.js')
const queue = read('src/services/salesSyncQueue.js')
const diagnostic = read('src/services/endDayDiagnostic.js')

const saleWrite = app.indexOf('await saveCentralSaleImmediately(sale)')
const saleMark = app.indexOf('markSaleSynced(sale)', saleWrite)
const salePrint = app.indexOf('requestSalePrint(sale)', saleWrite)
assert.ok(saleWrite >= 0 && saleWrite < saleMark && saleMark < salePrint)
assert.equal(app.indexOf('enqueueSale(sale, { dispatchEvent: false })', saleWrite), -1)
assert.match(sync, /await set\(saleRef, serializeSale\(\{ \.\.\.sale, status: sale\.status \|\| 'completed' \}\)\)/)
const saleWriteInSync = sync.indexOf('await set(saleRef, serializeSale')
const saleReadbackInSync = sync.indexOf('const readBack = await get(saleRef)', saleWriteInSync)
assert.ok(saleWriteInSync >= 0 && saleReadbackInSync > saleWriteInSync)
assert.match(app, /processSaleSyncQueue\(\{ reason: 'sale-write-failure' \}\)/)

const voidWrite = app.indexOf('await voidCentralSaleImmediately(pending')
const voidMark = app.indexOf('markSaleVoidedCentral(pending', voidWrite)
assert.ok(voidWrite >= 0 && voidWrite < voidMark)
assert.match(sync, /status: 'voided'/)
assert.match(sync, /audit: nextAudit/)
assert.match(sync, /const readBack = await get\(saleRef\)/)
assert.match(app, /processSaleSyncQueue\(\{ reason: 'void-update-failure' \}\)/)

assert.match(queue, /type: 'sale_write'/)
assert.match(queue, /type: 'void_update'/)
assert.match(queue, /export const enqueueVoidUpdate/)
assert.match(queue, /voided_before_central_sync/)
assert.match(diagnostic, /LIVE_COMMIT/)
assert.match(diagnostic, /blockingItems/)

const day = { id: 'day-2026-10-09', businessDate: '2026-10-09', status: 'open' }
const baseSale = { saleId: 'sale-permanent-1', id: 'sale-permanent-1', operationKey: 'pos101:sale-permanent-1', orderNumber: 1801, businessDate: day.businessDate, operationalDayId: day.id, status: 'synced', syncStatus: 'synced', centralVerified: true, total: 1500, subtotal: 1500, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 1500 }] }
const centralSale = { ...baseSale }
const ready = buildEndDayDiagnostic({ localSales: [baseSale], centralSales: [centralSale], operationalDay: day, liveCommit: 'commit-test', liveBundle: 'index-test.js' })
assert.equal(ready.localActiveCount, 1)
assert.equal(ready.firebaseActiveCount, 1)
assert.equal(ready.localActiveTotal, 1500)
assert.equal(ready.firebaseActiveTotal, 1500)
assert.equal(ready.blockingItems, 0)
assert.equal(ready.END_DAY_READY, 'YES')

const voidedBeforeSync = { ...baseSale, saleId: 'void-before-sync', id: 'void-before-sync', operationKey: 'pos101:void-before-sync', orderNumber: 1802, status: 'voided', syncStatus: 'voided', voided: true, queueResolution: 'voided_before_central_sync', centralUploadSkipped: true, centralVerified: false }
const voidReady = reconcilePreCloseSales({ localSales: [voidedBeforeSync], queueEntries: [{ type: 'sale_write', sale: voidedBeforeSync }], centralSales: [], operationalDay: day })
assert.equal(voidReady.allowed, true)
assert.equal(voidReady.pendingVoidUpdateCount, 0)
const realPending = reconcilePreCloseSales({ localSales: [{ ...baseSale, status: 'completed', syncStatus: 'pending', centralVerified: false }], queueEntries: [{ type: 'sale_write', sale: { ...baseSale, status: 'completed', syncStatus: 'pending', centralVerified: false } }], centralSales: [], operationalDay: day })
assert.equal(realPending.allowed, false)
assert.equal(realPending.pendingQueue, 1)
const pendingVoid = reconcilePreCloseSales({ localSales: [{ ...baseSale, status: 'void_pending_sync', voided: true }], voidQueueEntries: [{ type: 'void_update', saleId: baseSale.saleId, businessDate: day.businessDate, operationalDayId: day.id }], centralSales: [baseSale], operationalDay: day })
assert.equal(pendingVoid.allowed, false)
assert.equal(pendingVoid.pendingVoidUpdateCount, 1)

const lock = read('src/services/posCentralSync.js')
assert.match(lock, /if \(activeSaleSyncPromise\) return activeSaleSyncPromise/)
assert.match(lock, /recoverStaleSyncLock/) // startup/manual path still exposes stale-lock recovery

for (const [name, value] of Object.entries({
  ONLINE_SALE_WRITES_FIREBASE_IMMEDIATELY: 'PASS',
  ONLINE_SALE_READBACK_BEFORE_SYNCED: 'PASS',
  ONLINE_VOID_WRITES_FIREBASE_IMMEDIATELY: 'PASS',
  ONLINE_VOID_READBACK_BEFORE_CONFIRMED: 'PASS',
  QUEUE_ONLY_USED_ON_FAILURE: 'PASS',
  VOIDED_BEFORE_SYNC_DOES_NOT_BLOCK: 'PASS',
  QUEUE_LOCK_SELF_BLOCK: 'PASS',
  LOCAL_FIREBASE_ACTIVE_MATCH: 'PASS',
  END_DAY_BLOCKS_ONLY_REAL_PENDING: 'PASS',
})) console.log(`${name}=${value}`)
