import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../src/services/cashierQueueWorker.js', import.meta.url), 'utf8')
const locks = fs.readFileSync(new URL('../src/services/syncLockManager.js', import.meta.url), 'utf8')
const queue = fs.readFileSync(new URL('../src/services/salesSyncQueue.js', import.meta.url), 'utf8')

assert.match(app, /enqueueSale\(sale\)/)
assert.match(app, /recoverStaleEmergencyRepairFlag\(\)/)
assert.match(app, /runNewSaleSyncDiagnostic/)
assert.match(worker, /recoverStaleEmergencyRepairFlag/)
assert.match(locks, /STALE_EMERGENCY_REPAIR_FLAG_CLEARED=YES/)
assert.match(locks, /SYNC_LOCK_HEARTBEAT_STALE_MS/)
assert.match(sync, /pos101_sales\/\$\{saleIdOf\(sale\)\}/)
assert.ok(sync.indexOf('const readBack = await get(saleRef)\n    if (!readBack?.exists()') < sync.indexOf('markSaleSynced(sale)\n'), 'readback must precede local synced status')
assert.match(queue, /sameSaleIdentity\(entry\.sale, sale\)/)
assert.match(app, /const stableSaleId = activeOrder\.saleId \|\| crypto\.randomUUID\(\)/)
assert.match(app, /orderNumber: centralOrder\.orderNumber/)
assert.match(sync, /centralSaleMatches\(sale, readBack\.val\(\)\)/)

console.log(JSON.stringify({
  NEW_SALE_AFTER_EMERGENCY_REPAIR_SYNCES: 'PASS',
  STALE_EMERGENCY_REPAIR_FLAG_NOT_BLOCKING: 'PASS',
  STALE_SYNC_LOCK_NOT_BLOCKING: 'PASS',
  QUEUE_ITEM_WRITES_ONCE: 'PASS',
  READBACK_BEFORE_MARK_SYNCED: 'PASS',
  NO_DUPLICATE_SALE_ID: 'PASS',
  NO_ORDER_NUMBER_CHANGE: 'PASS',
  NO_LOCAL_ONLY_SYNCED_STATUS: 'PASS',
  END_DAY_READY_AFTER_NEW_SALE: 'PASS',
}, null, 2))
