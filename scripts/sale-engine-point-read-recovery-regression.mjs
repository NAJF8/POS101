import assert from 'node:assert/strict'

// Regression for the root cause behind sales staying stuck 'pending' on a
// degraded connection: after a write/readback failure, the engine used to
// re-verify by fetching the ENTIRE pos101_sales table (readCentralSales),
// which grows every day and is far more likely to fail on the same marginal
// network that caused the original failure. The fix adds a point read by
// saleId (readCentralSaleById) as the primary, lightweight re-check, with
// the full-table scan only as a fallback. These tests prove: (1) the point
// read is preferred and resolves the sale without a second write, (2) a
// collision via point read is still detected, (3) when the point read ITSELF
// fails (truly offline), the full-table fallback still recovers exactly as
// before, and (4) a 1000+ row central table never blocks recovery when the
// point read succeeds.

const storageMap = new Map()
globalThis.localStorage = {
  getItem: key => storageMap.get(String(key)) ?? null,
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: key => storageMap.delete(String(key)),
  key: index => [...storageMap.keys()][index] ?? null,
  get length () { return storageMap.size },
}
globalThis.window = { location: { hostname: 'localhost' }, dispatchEvent: () => {} }

const { createSaleEngine, SALE_ENGINE_STATES } = await import(`../src/services/saleEngine.js?point-read-regression=${Date.now()}`)
const day = { id: 'day-2026-11-12', businessDate: '2026-11-12', status: 'open' }
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

const bigHistoricalTable = Array.from({ length: 1200 }, (_, index) => ({
  saleId: `historical-${index}`,
  id: `historical-${index}`,
  operationKey: `pos101:historical-${index}`,
  orderNumber: index,
  businessDate: '2026-11-01',
  operationalDayId: 'old-day',
  status: 'completed',
  total: 1000,
  items: [{ id: 'coffee', quantity: 1, price: 1000 }],
}))

const makeHarness = ({ pointReadMode = 'found-exact', fullTableMode = 'works' } = {}) => {
  const central = new Map(bigHistoricalTable.map(sale => [sale.saleId, sale]))
  let writes = 0
  let pointReads = 0
  let fullTableReads = 0
  const engine = createSaleEngine({
    storage: globalThis.localStorage,
    readOperationalDay: async () => day,
    allocateOrderNumber: async () => ({ orderNumber: 1500, reserved: true, businessDate: day.businessDate, operationalDayId: day.id }),
    readCentralSaleById: async saleId => {
      pointReads += 1
      if (pointReadMode === 'network-down') throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' })
      if (pointReadMode === 'not-found') return null
      if (pointReadMode === 'collision') return { ...central.get(saleId), total: 999999 }
      return central.get(saleId) || null
    },
    readCentralSales: async ({ afterWriteFailure = false } = {}) => {
      fullTableReads += 1
      if (fullTableMode === 'fails') throw Object.assign(new Error('timeout fetching full table'), { code: 'TIMEOUT' })
      return [...central.values()]
    },
    writeCentralSale: async sale => {
      writes += 1
      // The write itself reached Firebase (central.set succeeds) but the
      // caller never gets a clean confirmation back - exactly the scenario
      // that leaves a sale looking 'pending' locally despite being safely
      // stored centrally.
      central.set(sale.saleId, { ...sale, status: 'completed' })
      throw Object.assign(new Error('readback timed out'), { code: 'READBACK_TIMEOUT' })
    },
    markLocalSynced: () => ({ centralVerified: true, cacheWrite: { ok: true } }),
    quarantineStaleQueue: () => ({ moved: 0 }),
  })
  return { engine, central, get writes () { return writes }, get pointReads () { return pointReads }, get fullTableReads () { return fullTableReads } }
}

{
  const h = makeHarness({ pointReadMode: 'found-exact' })
  const result = await h.engine.sell(input())
  assert.equal(result.ok, true)
  assert.equal(result.state, SALE_ENGINE_STATES.CONFIRMED)
  assert.equal(result.centralVerified, true)
  assert.equal(h.writes, 1, 'must not attempt a second write once the point read confirms the sale already exists')
  assert.equal(h.pointReads, 1)
  // One full-table read is the normal pre-write duplicate-collision preflight
  // (unchanged, runs before any write attempt). The fix is that the
  // failure-RECOVERY step itself never needs a second, larger table fetch
  // once the point read already resolved the sale.
  assert.equal(h.fullTableReads, 1, 'only the pre-write preflight scan should run; recovery must not need its own full-table fetch')
  console.log('POINT_READ_RESOLVES_WRITE_FAILURE_WITHOUT_FULL_TABLE_SCAN=PASS')
}

{
  const h = makeHarness({ pointReadMode: 'collision' })
  const result = await h.engine.sell(input())
  assert.equal(result.ok, false)
  assert.equal(result.state, SALE_ENGINE_STATES.FAILED_FINAL)
  assert.equal(result.errorClass, 'SALE_ID_COLLISION')
  console.log('POINT_READ_STILL_DETECTS_ID_COLLISION=PASS')
}

{
  const h = makeHarness({ pointReadMode: 'network-down', fullTableMode: 'works' })
  const result = await h.engine.sell(input())
  assert.equal(result.ok, true)
  assert.equal(result.state, SALE_ENGINE_STATES.CONFIRMED)
  assert.equal(h.pointReads, 1)
  // One full-table read for the pre-write preflight, one more for the
  // failure-recovery fallback (since the point read itself failed).
  assert.equal(h.fullTableReads, 2, 'falls back to the full-table scan only when the point read itself cannot be completed')
  console.log('FULL_TABLE_FALLBACK_STILL_WORKS_WHEN_POINT_READ_FAILS=PASS')
}

{
  const h = makeHarness({ pointReadMode: 'network-down', fullTableMode: 'fails' })
  const result = await h.engine.sell(input())
  assert.equal(result.ok, false)
  assert.equal(result.state, SALE_ENGINE_STATES.FAILED_RETRYABLE, 'a sale that truly cannot be verified stays pending/retryable - never silently marked synced')
  console.log('TRUE_NETWORK_OUTAGE_STAYS_RETRYABLE_NOT_LOST=PASS')
}

{
  const h = makeHarness({ pointReadMode: 'not-found', fullTableMode: 'fails' })
  const sameInput = input()
  const first = await h.engine.sell(sameInput)
  assert.equal(first.state, SALE_ENGINE_STATES.FAILED_RETRYABLE)
  // Network recovers; retrying the identical in-memory retry payload must
  // reuse the same saleId/operationKey and must not create a duplicate once
  // the write actually succeeds.
  const engine2 = createSaleEngine({
    storage: globalThis.localStorage,
    readOperationalDay: async () => day,
    allocateOrderNumber: async () => ({ orderNumber: 1501, reserved: true, businessDate: day.businessDate, operationalDayId: day.id }),
    readCentralSaleById: async () => null,
    readCentralSales: async () => [],
    writeCentralSale: async sale => ({ sale: { ...sale, status: 'completed' }, readbackVerified: true }),
    markLocalSynced: () => ({ centralVerified: true, cacheWrite: { ok: true } }),
    quarantineStaleQueue: () => ({ moved: 0 }),
  })
  const retried = await engine2.retry(input())
  assert.equal(retried.ok, true)
  assert.equal(retried.saleId, first.saleId)
  assert.equal(retried.operationKey, first.operationKey)
  console.log('NETWORK_RECOVERY_RETRY_SUCCEEDS_SAME_SALE_ID=PASS')
}

console.log('SALE_ENGINE_POINT_READ_RECOVERY_TESTS=PASS')
