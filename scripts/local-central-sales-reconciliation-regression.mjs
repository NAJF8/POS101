import assert from 'node:assert/strict'
import {
  SALES_CACHE_KEY,
  FULL_RECOVERY_BACKUP_PREFIX,
  MAX_BACKUP_AGE_MS,
  compactSalesCache,
  cleanupOversizedLocalCaches,
  inspectLocalStorage,
  isStaleFullRecoveryBackupKey,
  readSalesCache,
  resetInMemorySalesCache,
  writeSalesCache,
} from '../src/services/localSalesCache.js'
import { mergeBySaleId, mergeCentralSalesLocally } from '../src/services/posCentralSync.js'
import { reconcilePreCloseSales } from '../src/services/preCloseReconciliation.js'
import {
  canonicalSalesForOperationalDay,
  reconcileCanonicalSales,
  summarizeCanonicalSales,
} from '../src/services/canonicalSales.js'

class MemoryStorage {
  constructor({ quotaBytes = Infinity, failAllWrites = false } = {}) {
    this.values = new Map()
    this.quotaBytes = quotaBytes
    this.failAllWrites = failAllWrites
  }
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null }
  removeItem(key) { this.values.delete(String(key)) }
  setItem(key, value) {
    if (this.failAllWrites) {
      throw Object.assign(new Error('QuotaExceededError: storage is full'), { name: 'QuotaExceededError' })
    }
    const next = new Map(this.values)
    next.set(String(key), String(value))
    const bytes = [...next.values()].reduce((sum, entry) => sum + entry.length * 2, 0)
    if (bytes > this.quotaBytes) {
      throw Object.assign(new Error('Setting the value on Storage exceeded the quota'), { name: 'QuotaExceededError' })
    }
    this.values = next
  }
}

// Exact 15 production central sales from operational day f6c7ad95-e583-4349-924c-6a6e9c4eac6e (2026-11-10)
const central15Sales = [
  { saleId: 'sale-1996', id: 'sale-1996', operationKey: 'pos101:1996', orderNumber: 1996, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240001000, subtotal: 8000, discount: 0, total: 8000, paymentMethod: 'electronic', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2001', id: 'sale-2001', operationKey: 'pos101:2001', orderNumber: 2001, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240002000, subtotal: 11000, discount: 0, total: 11000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2000', id: 'sale-2000', operationKey: 'pos101:2000', orderNumber: 2000, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240003000, subtotal: 7500, discount: 0, total: 7500, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-1994', id: 'sale-1994', operationKey: 'pos101:1994', orderNumber: 1994, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240004000, subtotal: 11000, discount: 0, total: 11000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2006', id: 'sale-2006', operationKey: 'pos101:2006', orderNumber: 2006, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240005000, subtotal: 15000, discount: 0, total: 15000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2004', id: 'sale-2004', operationKey: 'pos101:2004', orderNumber: 2004, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240006000, subtotal: 9000, discount: 0, total: 9000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-1997', id: 'sale-1997', operationKey: 'pos101:1997', orderNumber: 1997, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240007000, subtotal: 22000, discount: 0, total: 22000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-1998', id: 'sale-1998', operationKey: 'pos101:1998', orderNumber: 1998, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240008000, subtotal: 10500, discount: 0, total: 10500, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2003', id: 'sale-2003', operationKey: 'pos101:2003', orderNumber: 2003, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240009000, subtotal: 14000, discount: 0, total: 14000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2005', id: 'sale-2005', operationKey: 'pos101:2005', orderNumber: 2005, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240010000, subtotal: 21500, discount: 0, total: 21500, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-1999', id: 'sale-1999', operationKey: 'pos101:1999', orderNumber: 1999, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240011000, subtotal: 15000, discount: 0, total: 15000, paymentMethod: 'electronic', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-1993', id: 'sale-1993', operationKey: 'pos101:1993', orderNumber: 1993, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240012000, subtotal: 6500, discount: 1500, total: 5000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-1995', id: 'sale-1995', operationKey: 'pos101:1995', orderNumber: 1995, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240013000, subtotal: 11000, discount: 0, total: 11000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2007', id: 'sale-2007', operationKey: 'pos101:2007', orderNumber: 2007, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240014000, subtotal: 13000, discount: 0, total: 13000, paymentMethod: 'electronic', status: 'completed', syncStatus: 'synced', centralVerified: true },
  { saleId: 'sale-2002', id: 'sale-2002', operationKey: 'pos101:2002', orderNumber: 2002, businessDate: '2026-11-10', operationalDayId: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e', createdAt: 1731240015000, subtotal: 11000, discount: 0, total: 11000, paymentMethod: 'cash', status: 'completed', syncStatus: 'synced', centralVerified: true },
]

const opDay = {
  id: 'f6c7ad95-e583-4349-924c-6a6e9c4eac6e',
  businessDate: '2026-11-10',
  status: 'open',
}

// ---------------------------------------------------------
// Test 1: Normal localStorage read/write
// ---------------------------------------------------------
resetInMemorySalesCache()
const healthyStorage = new MemoryStorage()
const writeResult1 = writeSalesCache(central15Sales.slice(0, 3), { storage: healthyStorage })
assert.equal(writeResult1.ok, true)
assert.equal(writeResult1.quota, false)
assert.equal(writeResult1.inMemoryFallback, false)
const readBack1 = readSalesCache(healthyStorage)
assert.equal(readBack1.length, 3)
assert.equal(readBack1[0].saleId, 'sale-2000') // newest first
console.log('TEST_1_HEALTHY_STORAGE_READ_WRITE=PASS')

// ---------------------------------------------------------
// Test 2: In-Memory Fallback when Storage Fails
// ---------------------------------------------------------
resetInMemorySalesCache()
const failedStorage = new MemoryStorage({ failAllWrites: true })
const writeResult2 = writeSalesCache(central15Sales, { storage: failedStorage })
assert.equal(writeResult2.ok, false)
assert.equal(writeResult2.quota, true)
assert.equal(writeResult2.inMemoryFallback, true)
// In-memory cache must return all 15 sales safely despite storage failure
const readBack2 = readSalesCache(failedStorage)
assert.equal(readBack2.length, 15)
assert.equal(readBack2[0].saleId, 'sale-2002')
console.log('TEST_2_IN_MEMORY_FALLBACK_ON_STORAGE_FAILURE=PASS')

// ---------------------------------------------------------
// Test 3: Cleanup of stale fullRecoveryBackup (> 48h)
// ---------------------------------------------------------
resetInMemorySalesCache()
const cleanupStorage = new MemoryStorage()
const now = Date.parse('2026-11-10T23:00:00.000Z')
const staleKey1 = 'pos101.fullRecoveryBackup.2026-10-03T18:47:06.671Z'
const staleKey2 = 'pos101.fullRecoveryBackup.2026-10-06T15:21:40.457Z'
const freshKey = 'pos101.fullRecoveryBackup.2026-11-10T20:00:00.000Z'
const otherAppKey = 'dew.products.v1'
const sessionKey = 'pos101.session'

cleanupStorage.setItem(staleKey1, JSON.stringify({ timestamp: '2026-10-03T18:47:06.671Z', data: 'stale-1' }))
cleanupStorage.setItem(staleKey2, JSON.stringify({ timestamp: '2026-10-06T15:21:40.457Z', data: 'stale-2' }))
cleanupStorage.setItem(freshKey, JSON.stringify({ timestamp: '2026-11-10T20:00:00.000Z', data: 'fresh' }))
cleanupStorage.setItem(otherAppKey, '{"other":"app-data"}')
cleanupStorage.setItem(sessionKey, '{"shiftId":"morning"}')
cleanupStorage.setItem(SALES_CACHE_KEY, JSON.stringify(central15Sales.slice(0, 2)))

assert.equal(isStaleFullRecoveryBackupKey(staleKey1, null, now), true)
assert.equal(isStaleFullRecoveryBackupKey(freshKey, null, now), false)
assert.equal(isStaleFullRecoveryBackupKey(otherAppKey, null, now), false)
assert.equal(isStaleFullRecoveryBackupKey(SALES_CACHE_KEY, null, now), false)

const cleanupResult = cleanupOversizedLocalCaches({ storage: cleanupStorage, now })
assert.equal(cleanupResult.cleanedKeys.includes(staleKey1), true)
assert.equal(cleanupResult.cleanedKeys.includes(staleKey2), true)
assert.equal(cleanupStorage.getItem(staleKey1), null)
assert.equal(cleanupStorage.getItem(staleKey2), null)
assert.notEqual(cleanupStorage.getItem(freshKey), null) // Fresh backup preserved!
assert.notEqual(cleanupStorage.getItem(otherAppKey), null) // Other app key preserved!
assert.notEqual(cleanupStorage.getItem(sessionKey), null) // Protected session key preserved!
assert.notEqual(cleanupStorage.getItem(SALES_CACHE_KEY), null) // Sales ledger preserved!
console.log('TEST_3_STALE_BACKUP_CLEANUP_WITH_PRESERVATION=PASS')

// ---------------------------------------------------------
// Test 4: Write auto-recovery after cleaning stale backups
// ---------------------------------------------------------
resetInMemorySalesCache()
// A storage with quota tight enough that 2 stale backups block it, but removing them frees enough room
const tightStorage = new MemoryStorage({ quotaBytes: 12000 })
tightStorage.setItem(staleKey1, 'x'.repeat(2000)) // 4000 bytes
tightStorage.setItem(staleKey2, 'x'.repeat(2000)) // 4000 bytes, total 8000 bytes
// Writing 5 sales (~5000 bytes) would exceed 12000 bytes unless stale backups are cleaned.
const writeAutoRecover = writeSalesCache(central15Sales.slice(0, 5), { storage: tightStorage, now })
assert.equal(writeAutoRecover.ok, true)
assert.equal(writeAutoRecover.quota, true) // Indicated quota cleanup occurred
assert.equal(writeAutoRecover.cleanedKeys.includes(staleKey1), true)
assert.equal(tightStorage.getItem(staleKey1), null)
assert.notEqual(tightStorage.getItem(SALES_CACHE_KEY), null)
console.log('TEST_4_WRITE_AUTO_RECOVERY_AFTER_CLEANUP=PASS')

// ---------------------------------------------------------
// Test 5: Merge 0 local sales with 15 central sales & Idempotency
// ---------------------------------------------------------
const localEmpty = []
const mergedOnce = mergeBySaleId(localEmpty, central15Sales)
assert.equal(mergedOnce.length, 15)
// Check idempotency: merge a second, third, fifth time
const mergedTwice = mergeBySaleId(mergedOnce, central15Sales)
assert.equal(mergedTwice.length, 15)
const mergedFiveTimes = mergeBySaleId(mergedTwice, central15Sales)
assert.equal(mergedFiveTimes.length, 15)
assert.deepEqual(mergedOnce.map(s => s.saleId), mergedFiveTimes.map(s => s.saleId))
console.log('TEST_5_MERGE_IDEMPOTENCY_ZERO_TO_15=PASS')

// ---------------------------------------------------------
// Test 6: Financial Core Invariants Verification
// ---------------------------------------------------------
const summary = summarizeCanonicalSales(mergedOnce)
assert.equal(summary.count, 15)
assert.equal(summary.gross, 186000)
assert.equal(summary.discount, 1500)
assert.equal(summary.net, 184500)
assert.equal(summary.cash, 148500)
assert.equal(summary.electronic, 36000)
assert.equal(summary.salesBalanced, true) // 186,000 - 1,500 === 184,500
assert.equal(summary.paymentsBalanced, true) // 148,500 + 36,000 === 184,500
console.log('TEST_6_FINANCIAL_CORE_INVARIANTS=PASS')

// ---------------------------------------------------------
// Test 7: Pre-Close Reconciliation passes after central merge
// ---------------------------------------------------------
// Without merge (the bug): localSales is empty, central has 15
const buggedReconcile = reconcilePreCloseSales({
  localSales: [],
  centralSales: central15Sales,
  operationalDay: opDay,
  openOrderCount: 0,
})
assert.equal(buggedReconcile.allowed, false)
assert.equal(buggedReconcile.message, 'توجد فروقات بين المبيعات المحلية والمركزية.')

// With merge (the fix): localSales now has the merged central sales
const fixedReconcile = reconcilePreCloseSales({
  localSales: mergedOnce,
  centralSales: central15Sales,
  operationalDay: opDay,
  openOrderCount: 0,
})
assert.equal(fixedReconcile.allowed, true)
assert.equal(fixedReconcile.message, '')
assert.equal(fixedReconcile.missingLocal.length, 0)
assert.equal(fixedReconcile.pendingQueue, 0)

// Canonical reconciliation before day close
const canonicalReconcile = reconcileCanonicalSales({
  localSales: mergedOnce,
  centralSales: central15Sales,
  operationalDay: opDay,
})
assert.equal(canonicalReconcile.allowed, true)
assert.equal(canonicalReconcile.missingLocalIds.length, 0)
assert.equal(canonicalReconcile.missingCentralIds.length, 0)
assert.equal(canonicalReconcile.totalsMatch, true)
console.log('TEST_7_PRE_CLOSE_RECONCILIATION_PASSES=PASS')

// ---------------------------------------------------------
// Test 8: End-to-end simulated pre-close with storage failure
// ---------------------------------------------------------
// Simulate browser where localStorage setItem throws QuotaExceededError
resetInMemorySalesCache()
const quotaExceededStorage = new MemoryStorage({ failAllWrites: true })
// Old October sales in storage that couldn't be overwritten
quotaExceededStorage.values.set(SALES_CACHE_KEY, JSON.stringify([
  { saleId: 'old-oct-1', createdAt: 1729500000000, total: 5000, status: 'completed', syncStatus: 'synced', centralVerified: true }
]))

// When mergeCentralSalesLocally is executed, writeSalesCache encounters quota failure
// but transparently stores merged sales in memory fallback
writeSalesCache(central15Sales, { storage: quotaExceededStorage })
const effectiveLocalSales = readSalesCache(quotaExceededStorage)
assert.equal(effectiveLocalSales.length, 15) // In-memory fallback took precedence because its sales are newer (Nov 10 vs Oct 21)

const e2eReconcile = reconcilePreCloseSales({
  localSales: effectiveLocalSales,
  centralSales: central15Sales,
  operationalDay: opDay,
  openOrderCount: 0,
})
assert.equal(e2eReconcile.allowed, true)
assert.equal(e2eReconcile.message, '')
console.log('TEST_8_PRE_CLOSE_PASSES_UNDER_STORAGE_FAILURE=PASS')

console.log('\n========================================')
console.log('ALL LOCAL/CENTRAL RECONCILIATION TESTS PASSED!')
console.log('========================================')
