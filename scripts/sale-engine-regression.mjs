import assert from 'node:assert/strict'
import fs from 'node:fs'

const storageMap = new Map()
globalThis.localStorage = {
  getItem: key => storageMap.get(String(key)) ?? null,
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: key => storageMap.delete(String(key)),
  key: index => [...storageMap.keys()][index] ?? null,
  get length () { return storageMap.size },
}
globalThis.window = { location: { hostname: 'localhost' }, dispatchEvent: () => {} }

const { createSaleEngine, SALE_ENGINE_STATES } = await import(`../src/services/saleEngine.js?regression=${Date.now()}`)
const day = { id: 'day-2026-10-10', businessDate: '2026-10-10', status: 'open' }
const input = (overrides = {}) => ({
  activeOrder: {
    id: 1,
    orderType: 'داخل الكوفي',
    items: [{ id: 'latte', productId: 'latte', name: 'لاتيه', displayName: 'لاتيه', quantity: 1, price: 6000, unitPrice: 6000, options: [{ id: 'size', label: 'عادي', priceDelta: 0 }], additions: [] }],
  },
  payment: { method: 'cash', received: 6000, change: 0 },
  sellerName: 'كاشير اختبار',
  session: { shiftId: 'morning', shiftType: 'morning', shiftLabel: 'صباحي', name: 'كاشير صباحي' },
  subtotal: 6000,
  discount: 0,
  total: 6000,
  ...overrides,
})

const makeHarness = ({ writeMode = 'success', readAfterFailure = true, cacheWrite = { ok: true } } = {}) => {
  const central = new Map()
  let currentWriteMode = writeMode
  let allocations = 0
  let writes = 0
  let failureReads = 0
  const engine = createSaleEngine({
    storage: globalThis.localStorage,
    readOperationalDay: async () => day,
    allocateOrderNumber: async () => ({ orderNumber: 1400 + (++allocations), reserved: true, businessDate: day.businessDate, operationalDayId: day.id }),
    readCentralSales: async ({ afterWriteFailure = false } = {}) => {
      if (afterWriteFailure && !readAfterFailure) return []
      if (afterWriteFailure && failureReads++ === 0 && currentWriteMode === 'write-then-readback-fail') return []
      return [...central.values()]
    },
    writeCentralSale: async sale => {
      writes += 1
      if (currentWriteMode === 'write-fail') throw Object.assign(new Error('temporary network failure'), { code: 'NETWORK_ERROR' })
      central.set(sale.saleId, { ...sale, status: 'completed' })
      if (currentWriteMode === 'write-then-readback-fail') throw Object.assign(new Error('readback timed out'), { code: 'READBACK_TIMEOUT' })
      return { sale: central.get(sale.saleId), readbackVerified: true }
    },
    markLocalSynced: () => ({ centralVerified: true, cacheWrite }),
    quarantineStaleQueue: () => ({ moved: 2, firebaseWritesPerformed: 0 }),
  })
  return { engine, central, setWriteMode: value => { currentWriteMode = value }, get allocations () { return allocations }, get writes () { return writes } }
}

{
  const h = makeHarness()
  const result = await h.engine.sell(input())
  assert.equal(result.ok, true)
  assert.equal(result.state, SALE_ENGINE_STATES.CONFIRMED)
  assert.equal(result.centralVerified, true)
  assert.equal(result.shouldClearCart, true)
  assert.equal(h.writes, 1)
  console.log('SUCCESS_WRITE_READBACK_CLEAR_CART=PASS')
}

{
  const h = makeHarness({ writeMode: 'write-fail' })
  const failed = await h.engine.sell(input())
  h.setWriteMode('success')
  const retried = await h.engine.retry(input())
  assert.equal(failed.state, SALE_ENGINE_STATES.FAILED_RETRYABLE)
  assert.equal(retried.ok, true)
  assert.equal(failed.saleId, retried.saleId)
  assert.equal(failed.operationKey, retried.operationKey)
  assert.equal(failed.orderNumber, retried.orderNumber)
  assert.equal(h.writes, 2)
  console.log('WRITE_FAILURE_KEEP_CART=PASS')
  console.log('RETRY_SAME_SALE_ID_OPERATION_KEY_ORDER=PASS')
}

{
  const h = makeHarness({ writeMode: 'write-then-readback-fail' })
  const first = await h.engine.sell(input())
  assert.equal(first.state, SALE_ENGINE_STATES.FAILED_RETRYABLE)
  const second = await h.engine.retry(input())
  assert.equal(second.ok, true)
  assert.equal(h.writes, 1)
  console.log('READBACK_FAILURE_RETRY_READS_FIREBASE_FIRST=PASS')
  console.log('NO_BLIND_REWRITE_AFTER_READBACK_FAILURE=PASS')
}

{
  const h = makeHarness()
  const [left, right] = await Promise.all([h.engine.sell(input()), h.engine.sell(input())])
  assert.equal(left.saleId, right.saleId)
  assert.equal(h.writes, 1)
  console.log('DOUBLE_CLICK_ONE_SALE_ONLY=PASS')
  console.log('SALE_IN_FLIGHT_LOCK=PASS')
}

{
  const h = makeHarness()
  const result = await h.engine.sell(input({ activeOrder: { items: [{ id: 'bad', quantity: 1, price: Number.NaN }] } }))
  assert.equal(result.ok, false)
  assert.equal(result.errorClass, 'PAYLOAD_INVALID')
  assert.equal(h.writes, 0)
  console.log('CART_NORMALIZATION_BEFORE_SALE=PASS')
  console.log('INVALID_CART_NEVER_WRITES=PASS')
}

{
  const h = makeHarness({ cacheWrite: { ok: false } })
  const result = await h.engine.sell(input())
  assert.equal(result.ok, true)
  assert.equal(result.centralVerified, true)
  assert.match(result.diagnostics.localCacheWarning, /تم تثبيت الطلب مركزيًا/)
  console.log('QUOTA_DOES_NOT_BREAK_CONFIRMED_SALE=PASS')
}

{
  const h = makeHarness()
  const originalRead = h.engine
  const duplicateEngine = createSaleEngine({
    storage: globalThis.localStorage,
    readOperationalDay: async () => day,
    allocateOrderNumber: async () => ({ orderNumber: 1499, reserved: true }),
    readCentralSales: async ({ sale }) => [{ ...sale, status: 'completed' }, { ...sale, status: 'completed' }],
    writeCentralSale: async () => { throw new Error('must not write') },
    markLocalSynced: () => ({ centralVerified: true, cacheWrite: { ok: true } }),
    quarantineStaleQueue: () => ({ moved: 0 }),
  })
  const result = await duplicateEngine.sell(input())
  assert.equal(result.ok, false)
  assert.equal(result.errorClass, 'TRUE_DUPLICATE')
  assert.equal(originalRead.getState().state, SALE_ENGINE_STATES.IDLE)
  console.log('TRUE_DUPLICATE_BLOCKED=PASS')
}

{
  const source = fs.readFileSync(new URL('../src/services/saleEngine.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage\.setItem\(['"]pos101\.sales/)
  assert.match(source, /CURRENT_SALE_RETRY_KEY/)
  console.log('NO_FULL_POS101_SALES_WRITE=PASS')
  console.log('CURRENT_RETRY_SEPARATED_FROM_OLD_QUEUE=PASS')
}

console.log('SALE_ENGINE_TESTS=PASS')

