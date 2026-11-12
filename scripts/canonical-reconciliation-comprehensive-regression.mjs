import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reconcileCanonicalSales, normalizeSaleForReconciliation, summarizeCanonicalSales } from '../src/services/canonicalSales.js'
import { actualCashDiscountOf } from '../src/services/reportSales.js'

const day = { id: 'c010b9d8-6a7b-4784-853d-d92ba23da409', businessDate: '2026-11-11' }

const makeSale = (id, orderNumber, { subtotal = 10000, discount = 0, total = 10000, paymentMethod = 'cash', discountDetails = undefined, status = 'completed', voided = false } = {}) => ({
  id,
  saleId: id,
  orderNumber,
  operationKey: `pos101:${id}`,
  operationalDayId: day.id,
  businessDate: day.businessDate,
  subtotal,
  discount,
  discountDetails,
  total,
  paymentMethod,
  status,
  voided,
})

// ==============================================================================
// TEST 1: Matching count + net + discount -> ALLOWED
// ==============================================================================
const s1 = makeSale('s-1', 1, { subtotal: 10000, discount: 1000, total: 9000, paymentMethod: 'cash' })
const s2 = makeSale('s-2', 2, { subtotal: 5000, discount: 0, total: 5000, paymentMethod: 'electronic' })
const matchingLocal = [s1, s2]
const matchingCentral = [s1, s2]
const res1 = reconcileCanonicalSales({ localSales: matchingLocal, centralSales: matchingCentral, operationalDay: day })
assert.equal(res1.allowed, true, 'Test 1: allowed must be true for matching sales')
assert.equal(res1.reason, '', 'Test 1: reason must be empty')
assert.equal(res1.totalsMatch, true)
console.log('TEST_1_MATCHING_ALLOWED=PASS')

// ==============================================================================
// TEST 2: Same count + net, different discount -> BLOCKED (DISCOUNT_MISMATCH)
// ==============================================================================
const s2Local = makeSale('s-2', 2, { subtotal: 5000, discount: 0, total: 5000 })
const s2CentralDifferentDiscount = makeSale('s-2', 2, { subtotal: 5500, discount: 500, total: 5000 })
const res2 = reconcileCanonicalSales({
  localSales: [s1, s2Local],
  centralSales: [s1, s2CentralDifferentDiscount],
  operationalDay: day,
})
assert.equal(res2.allowed, false, 'Test 2: different discount must block')
assert.equal(res2.reason, 'DISCOUNT_MISMATCH', 'Test 2: reason must be DISCOUNT_MISMATCH')
assert.match(res2.message, /خصومات المبيعات/)
assert.equal(res2.discountDifference, -500)
console.log('TEST_2_DISCOUNT_MISMATCH_BLOCKED=PASS')

// ==============================================================================
// TEST 3: Count mismatch -> BLOCKED (LOCAL_CENTRAL_SALES_COUNT_MISMATCH)
// ==============================================================================
const res3 = reconcileCanonicalSales({
  localSales: [s1, s2],
  centralSales: [s1],
  operationalDay: day,
})
assert.equal(res3.allowed, false)
assert.equal(res3.reason, 'LOCAL_CENTRAL_SALES_COUNT_MISMATCH')
console.log('TEST_3_COUNT_MISMATCH_BLOCKED=PASS')

// ==============================================================================
// TEST 4: Total mismatch -> BLOCKED (LOCAL_CENTRAL_SALES_TOTAL_MISMATCH)
// ==============================================================================
const s2ModifiedTotal = makeSale('s-2', 2, { subtotal: 6000, discount: 0, total: 6000 })
const res4 = reconcileCanonicalSales({
  localSales: [s1, s2],
  centralSales: [s1, s2ModifiedTotal],
  operationalDay: day,
})
assert.equal(res4.allowed, false)
assert.equal(res4.reason, 'LOCAL_CENTRAL_SALES_TOTAL_MISMATCH')
console.log('TEST_4_TOTAL_MISMATCH_BLOCKED=PASS')

// ==============================================================================
// TEST 5: Missing local sale -> BLOCKED (CENTRAL_SALES_CANONICAL_MISMATCH)
// ==============================================================================
const s3 = makeSale('s-3', 3, { subtotal: 3000, total: 3000 })
const res5 = reconcileCanonicalSales({
  localSales: [s1, s2],
  centralSales: [s1, s2, s3],
  operationalDay: day,
})
assert.equal(res5.allowed, false)
assert.equal(res5.missingLocalIds.length, 1)
assert.equal(res5.missingLocalIds[0], 's-3')
console.log('TEST_5_MISSING_LOCAL_BLOCKED=PASS')

// ==============================================================================
// TEST 6: Missing central sale -> BLOCKED (CENTRAL_SALES_CANONICAL_MISMATCH)
// ==============================================================================
const res6 = reconcileCanonicalSales({
  localSales: [s1, s2, s3],
  centralSales: [s1, s2],
  operationalDay: day,
})
assert.equal(res6.allowed, false)
assert.equal(res6.missingCentralIds.length, 1)
assert.equal(res6.missingCentralIds[0], 's-3')
console.log('TEST_6_MISSING_CENTRAL_BLOCKED=PASS')

// ==============================================================================
// TEST 7: Order 2009 canceled discount normalization (subtotal == total)
// ==============================================================================
const order2009 = makeSale('df3250e6-6e3a-4445-9619-a653f35107df', 2009, {
  subtotal: 44000,
  discount: 0,
  total: 44000,
  discountDetails: { input: 500, kind: 'amount', value: 500 },
})
const norm2009 = normalizeSaleForReconciliation(order2009)
assert.equal(norm2009.discount, 0, 'Order 2009 normalized discount must be 0')
assert.equal(norm2009.subtotal, 44000)
assert.equal(norm2009.total, 44000)
assert.equal(actualCashDiscountOf(order2009), 0, 'actualCashDiscountOf must be 0 when subtotal == total')
console.log('TEST_7_ORDER_2009_CANCELED_DISCOUNT_PASS=PASS')

// ==============================================================================
// TEST 8: Full Day 2026-11-11 real sales data from central export
// ==============================================================================
const exportPath = 'C:/Users/MSI/Downloads/cmms-37512-default-rtdb-pos101_sales-export.json'
if (fs.existsSync(exportPath)) {
  const salesExport = JSON.parse(fs.readFileSync(exportPath, 'utf8'))
  const centralSales = Object.values(salesExport).filter(s => s.operationalDayId === day.id)
  
  // Local sales as stored in cache (where discount for 2009 was 0)
  const localSales = centralSales.map(s => {
    if (s.orderNumber === 2009) {
      return { ...s, discount: 0, discountDetails: undefined }
    }
    return { ...s }
  })

  const dayReconciliation = reconcileCanonicalSales({ localSales, centralSales, operationalDay: day })
  assert.equal(dayReconciliation.localSummary.count, 14, 'Local active count must be 14')
  assert.equal(dayReconciliation.centralSummary.count, 14, 'Central active count must be 14')
  assert.equal(dayReconciliation.localSummary.total, undefined) // check summary fields
  assert.equal(dayReconciliation.localSummary.gross, 179500, 'Local gross must be 179,500')
  assert.equal(dayReconciliation.centralSummary.gross, 179500, 'Central gross must be 179,500')
  assert.equal(dayReconciliation.localSummary.discount, 3600, 'Local discount must be 3,600')
  assert.equal(dayReconciliation.centralSummary.discount, 3600, 'Central discount must be 3,600 (fixed from 4,100)')
  assert.equal(dayReconciliation.localSummary.net, 175900, 'Local net must be 175,900')
  assert.equal(dayReconciliation.centralSummary.net, 175900, 'Central net must be 175,900')
  assert.equal(dayReconciliation.discountDifference, 0, 'Discount difference must be 0')
  assert.equal(dayReconciliation.localSummary.salesBalanced, true, 'Local must be balanced')
  assert.equal(dayReconciliation.centralSummary.salesBalanced, true, 'Central must be balanced')
  assert.equal(dayReconciliation.totalsMatch, true, 'All totals must match')
  assert.equal(dayReconciliation.missingLocalIds.length, 0)
  assert.equal(dayReconciliation.missingCentralIds.length, 0)
  assert.equal(dayReconciliation.allowed, true, 'Day reconciliation must be ALLOWED')
  console.log('TEST_8_REAL_DAY_2026_11_11_RECONCILIATION_ALLOWED=PASS')
}

console.log('ALL_CANONICAL_RECONCILIATION_COMPREHENSIVE_TESTS=PASS')
