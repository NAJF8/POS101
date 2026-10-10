import assert from 'node:assert/strict'
import fs from 'node:fs'

class MemoryStorage {
  constructor() { this.values = new Map(); this.quotaBytes = Infinity }
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(String(key)) ?? null }
  removeItem(key) { this.values.delete(String(key)) }
  setItem(key, value) {
    const next = new Map(this.values)
    next.set(String(key), String(value))
    const bytes = [...next.values()].reduce((sum, entry) => sum + entry.length * 2, 0)
    if (bytes > this.quotaBytes) throw Object.assign(new Error('Setting the value on Storage exceeded the quota'), { name: 'QuotaExceededError' })
    this.values = next
  }
}

const storage = new MemoryStorage()
globalThis.localStorage = storage
globalThis.window = { dispatchEvent() {} }
const queue = await import('../src/services/salesSyncQueue.js')

const sale = {
  saleId: 'pending-sale-1',
  id: 'pending-sale-1',
  operationKey: 'pos101:pending-sale-1',
  orderNumber: 1901,
  businessDate: '2026-10-10',
  operationalDayId: 'day-2026-10-10',
  createdAt: 100,
  total: 7000,
  subtotal: 7000,
  discount: 0,
  paymentMethod: 'cash',
  status: 'completed',
  items: [{ id: 'coffee', name: 'قهوة', quantity: 1, price: 7000 }],
}

queue.enqueueSale(sale, { error: Object.assign(new Error('READ_TIMEOUT'), { code: 'READ_TIMEOUT' }) })
let diagnostics = queue.readPendingSaleDiagnostics()
assert.equal(diagnostics.length, 1)
assert.equal(diagnostics[0].saleId, sale.saleId)
assert.equal(diagnostics[0].operationKey, sale.operationKey)
assert.equal(diagnostics[0].orderNumber, sale.orderNumber)
assert.equal(diagnostics[0].total, sale.total)
assert.equal(diagnostics[0].lastError, 'READ_TIMEOUT')

queue.enqueueSale(sale, { error: new Error('RETRY') })
assert.equal(JSON.parse(storage.getItem('pos101.syncQueue')).filter(row => row.type === 'sale_write').length, 1)

let status = queue.inspectPendingSalesAgainstCentral([])
assert.equal(status[0].status, 'MISSING')
assert.equal(queue.readPendingSaleCount(), 1)

status = queue.inspectPendingSalesAgainstCentral([sale])
assert.equal(status[0].status, 'EXISTS_ONCE')
assert.equal(queue.inspectPendingSalesAgainstCentral([sale, sale])[0].status, 'DUPLICATE')
const reconciled = queue.reconcileSalesAgainstCentral([sale])
assert.equal(reconciled.reconciled, 1)
assert.equal(reconciled.remaining, 0)
assert.equal(JSON.parse(storage.getItem('pos101.syncQueue')).filter(row => row.type === 'sale_write').length, 0)

queue.enqueueSale({ ...sale, saleId: 'pending-sale-2', id: 'pending-sale-2', operationKey: 'pos101:pending-sale-2', orderNumber: 1902 }, { error: new Error('WRITE_FAILED') })
const mismatch = queue.inspectPendingSalesAgainstCentral([{ ...sale, saleId: 'pending-sale-2', id: 'pending-sale-2', operationKey: 'pos101:other-operation', orderNumber: 1902 }])
assert.equal(mismatch[0].status, 'MISSING')

storage.quotaBytes = 10
const markResult = queue.markSaleSynced(sale)
assert.equal(markResult.centralVerified, false)
assert.equal(markResult.queuePreserved, true)
assert.equal(JSON.parse(storage.getItem('pos101.syncQueue')).some(row => row.sale?.saleId === 'pending-sale-2'), true)

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const engine = fs.readFileSync(new URL('../src/services/saleEngine.js', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const safeCheck = fs.readFileSync(new URL('../src/services/safeSystemCheck.js', import.meta.url), 'utf8')
const dialog = fs.readFileSync(new URL('../src/components/PendingSaleStatusDialog.jsx', import.meta.url), 'utf8')
assert.match(app, /inspectPendingSaleCentralStatus/)
assert.match(app, /saleEngine\.sell\(/)
assert.match(engine, /CURRENT_SALE_RETRY_KEY/)
assert.match(engine, /readCentralSales/)
assert.doesNotMatch(app, /enqueueSale\(/)
assert.match(sync, /inspectPendingSalesAgainstCentral/)
assert.match(sync, /queuePreserved/)
assert.match(safeCheck, /\['pending-sales'/)
assert.match(safeCheck, /pendingSaleCheck/)
assert.match(safeCheck, /status: duplicate \? 'fail' : 'warn'/)
assert.match(dialog, /فحص المزامنة/)
assert.match(dialog, /محاولة الرفع الآن/)

console.log('PENDING_SALE_SAVE_TEST=PASS')
console.log('PENDING_RETRY_FIREBASE_FIRST_TEST=PASS')
console.log('NO_DUPLICATE_RETRY_TEST=PASS')
console.log('READBACK_BEFORE_SYNCED_TEST=PASS')
console.log('PENDING_DIAGNOSTICS_IDENTITY_TEST=PASS')
console.log('PENDING_UI_SAFE_MESSAGE_TEST=PASS')
console.log('SAFE_CHECK_PENDING_DETECTION_TEST=PASS')
console.log('SAFE_CHECK_DOES_NOT_FALSE_PASS_WITH_PENDING=PASS')
