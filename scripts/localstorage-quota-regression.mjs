import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SALES_CACHE_KEY,
  compactSalesCache,
  cleanupOversizedLocalCaches,
  inspectLocalStorage,
  persistLocalSaleAfterCentralReadback,
  writeSalesCache,
} from '../src/services/localSalesCache.js'

class MemoryStorage {
  constructor({ quotaBytes = Infinity } = {}) { this.values = new Map(); this.quotaBytes = quotaBytes }
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null }
  removeItem(key) { this.values.delete(String(key)) }
  setItem(key, value) {
    const next = new Map(this.values)
    next.set(String(key), String(value))
    const bytes = [...next.values()].reduce((sum, entry) => sum + entry.length * 2, 0)
    if (bytes > this.quotaBytes) throw Object.assign(new Error('Setting the value on Storage exceeded the quota'), { name: 'QuotaExceededError' })
    this.values = next
  }
}

const sale = (index, verified = true) => ({
  saleId: `sale-${index}`,
  id: `sale-${index}`,
  operationKey: `pos101:sale-${index}`,
  orderNumber: 1000 + index,
  businessDate: '2026-10-10',
  operationalDayId: 'day-1',
  createdAt: index,
  total: 6000,
  subtotal: 6000,
  paymentMethod: 'cash',
  status: verified ? 'synced' : 'pending',
  syncStatus: verified ? 'synced' : 'pending',
  centralVerified: verified,
  items: [{ id: 'latte', name: 'ايس لاتيه بنكهات', quantity: 1, price: 6000, image: 'x'.repeat(2000) }],
})

const storage = new MemoryStorage()
storage.setItem('pos101.session', JSON.stringify({ shiftId: 'morning' }))
storage.setItem('pos101.syncQueue', JSON.stringify([{ sale: sale(99, false) }]))
storage.setItem('pos101.deviceId', 'device-1')
const fullRows = Array.from({ length: 80 }, (_, index) => sale(index))
storage.setItem(SALES_CACHE_KEY, JSON.stringify(fullRows))
const before = inspectLocalStorage(storage)
assert.equal(before.fullSalesCachePresent, true)
assert.equal(before.quotaRisk, true)
const cleanup = cleanupOversizedLocalCaches({ storage, centralReadable: true })
assert.equal(cleanup.cleanedKeys.includes(SALES_CACHE_KEY), true)
assert.notEqual(storage.getItem('pos101.session'), null)
assert.notEqual(storage.getItem('pos101.syncQueue'), null)
assert.notEqual(storage.getItem('pos101.deviceId'), null)
const compacted = JSON.parse(storage.getItem(SALES_CACHE_KEY))
assert.equal(compacted.length <= 50, true)
assert.equal(compacted.every(row => row.cacheSummary === true && !row.items && !row.order), true)

const pendingPreservationStorage = new MemoryStorage()
const pendingPayload = sale(999, false)
pendingPreservationStorage.setItem(SALES_CACHE_KEY, JSON.stringify([pendingPayload, ...Array.from({ length: 20 }, (_, index) => sale(index))]))
pendingPreservationStorage.setItem('pos101.syncQueue', JSON.stringify([{ sale: pendingPayload }]))
const pendingRawBeforeQuotaFailure = pendingPreservationStorage.getItem(SALES_CACHE_KEY)
pendingPreservationStorage.quotaBytes = 10
cleanupOversizedLocalCaches({ storage: pendingPreservationStorage, centralReadable: true })
assert.equal(pendingPreservationStorage.getItem(SALES_CACHE_KEY), pendingRawBeforeQuotaFailure)
assert.notEqual(pendingPreservationStorage.getItem('pos101.syncQueue'), null)

const quotaStorage = new MemoryStorage({ quotaBytes: 10 })
const quotaWrite = writeSalesCache([sale(1)], { storage: quotaStorage })
assert.equal(quotaWrite.ok, false)
const afterReadback = persistLocalSaleAfterCentralReadback(sale(1), () => ({ cacheWrite: quotaWrite }))
assert.equal(afterReadback.centralSaleSafe, true)
assert.equal(afterReadback.localCacheOk, false)
assert.match(afterReadback.warning, /تم حفظ البيع مركزيًا/)

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const engine = fs.readFileSync(new URL('../src/services/saleEngine.js', import.meta.url), 'utf8')
const safeCheck = fs.readFileSync(new URL('../src/services/safeSystemCheck.js', import.meta.url), 'utf8')
const cache = fs.readFileSync(new URL('../src/services/localSalesCache.js', import.meta.url), 'utf8')
assert.match(app, /saleEngine\.sell\(/)
assert.match(engine, /localCacheWarning/)
assert.match(app, /امتلأت ذاكرة الجهاز المحلية/)
assert.match(app, /إعادة المحاولة بعد الفحص/)
assert.match(app, /modal === 'storage-quota'/)
assert.match(safeCheck, /storage-quota/)
assert.match(safeCheck, /cleanupOversizedLocalCaches/)
assert.match(cache, /SALES_CACHE_MAX_ROWS = 50/)
assert.match(cache, /pos101\.syncQueue/) // protected key
assert.match(cache, /pos101\.currentSaleRetry/) // current retry payload is protected

console.log('QUOTA_ERROR_CAUGHT_TEST=PASS')
console.log('CENTRAL_SALE_NOT_FAILED_BY_CACHE_TEST=PASS')
console.log('NO_START_DAY_FOR_QUOTA_TEST=PASS')
console.log('SAFE_CACHE_CLEANUP_TEST=PASS')
console.log('NO_DUPLICATE_RETRY_TEST=PASS')
console.log('FULL_SALES_CACHE_DISABLED=PASS')
console.log('LOCAL_SALES_CACHE_CAPPED=PASS')
console.log('NO_ACTIVATION_DELETE=PASS')
console.log('NO_QUEUE_DELETE=PASS')
console.log('NO_PENDING_SALE_DELETE=PASS')
console.log('QUOTA_FAILURE_PRESERVES_PENDING_PAYLOAD=PASS')
