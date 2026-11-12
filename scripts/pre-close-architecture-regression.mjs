import assert from 'node:assert/strict'
import {
  PRE_CLOSE_STATE,
  beginPreCloseCheck,
  completePreCloseCheck,
  failPreCloseCheck,
  isCurrentPreCloseRequest,
  isLatestPreCloseRequest,
} from '../src/services/preCloseGuard.js'
import { buildPreCloseDiagnostic } from '../src/services/preCloseDiagnostic.js'

const day = { id: 'c010b9d8-6a7b-4784-853d-d92ba23da409', businessDate: '2026-11-11' }

// ==============================================================================
// TEST 1: Contract structure & separation of reconciliations
// ==============================================================================
const sampleResult = {
  allowed: true,
  state: PRE_CLOSE_STATE.ALLOWED,
  loading: false,
  requestId: 101,
  businessDate: day.businessDate,
  operationalDayId: day.id,
  centralDay: day,
  freshCentralSales: [],
  sales: {
    allowed: true,
    localCount: 14,
    centralCount: 14,
    localTotal: 175900,
    centralTotal: 175900,
    missingLocal: [],
    missingCentral: [],
  },
  salesReconciliation: {
    allowed: true,
    localActiveCount: 14,
    centralActiveCount: 14,
    localActiveTotal: 175900,
    centralActiveTotal: 175900,
    pendingQueue: 0,
  },
  canonical: {
    allowed: true,
    localDiscount: 3600,
    centralDiscount: 3600,
    discountDifference: 0,
    localNet: 175900,
    centralNet: 175900,
    differences: [],
  },
  canonicalSalesReconciliation: {
    allowed: true,
    localSummary: { count: 14, gross: 179500, discount: 3600, net: 175900 },
    centralSummary: { count: 14, gross: 179500, discount: 3600, net: 175900 },
    discountDifference: 0,
  },
  financial: {
    allowed: true,
    pendingExpenseCount: 0,
    pendingWithdrawals: 0,
  },
  financialReconciliation: {
    allowed: true,
    pendingExpenseCount: 0,
    pendingWithdrawals: 0,
  },
  queue: {
    pendingCount: 0,
    pendingSaleWriteCount: 0,
    pendingVoidUpdateCount: 0,
    activePendingQueueCount: 0,
  },
  openOrdersCount: 0,
  reason: '',
  message: 'لا توجد طلبات معلقة. يمكنك إنهاء اليوم.',
}

const diag = buildPreCloseDiagnostic({
  requestId: 101,
  operationalDay: day,
  result: sampleResult,
  state: PRE_CLOSE_STATE.ALLOWED,
  loading: false,
  allowed: true,
})

assert.equal(diag.allowed, true)
assert.equal(diag.salesAllowed, true)
assert.equal(diag.canonicalSalesAllowed, true)
assert.equal(diag.financialAllowed, true)
assert.equal(diag.localSalesCount, 14)
assert.equal(diag.centralSalesCount, 14)
assert.equal(diag.localSalesTotal, 175900)
assert.equal(diag.centralSalesTotal, 175900)
assert.equal(diag.localDiscount, 3600)
assert.equal(diag.centralDiscount, 3600)
assert.equal(diag.discountDifference, 0)
assert.equal(diag.openOrdersCount, 0)
assert.equal(diag.pendingQueue, 0)
assert.equal(diag.reason, '')
console.log('TEST_1_CONTRACT_STRUCTURE_VERIFIED=PASS')

// ==============================================================================
// TEST 2: Open Orders -> BLOCKED (OPEN_ORDERS)
// ==============================================================================
const openOrderResult = {
  ...sampleResult,
  allowed: false,
  openOrdersCount: 1,
  sales: { ...sampleResult.sales, allowed: false },
  salesReconciliation: { ...sampleResult.salesReconciliation, allowed: false, openOrderCount: 1, openOrdersCount: 1 },
  reason: 'OPEN_ORDERS',
  message: 'يوجد طلب مفتوح، أكمله أو ألغِه قبل إنهاء اليوم.',
}
const diagOpenOrders = buildPreCloseDiagnostic({
  requestId: 102,
  operationalDay: day,
  result: openOrderResult,
  state: PRE_CLOSE_STATE.BLOCKED,
  loading: false,
  allowed: false,
})
assert.equal(diagOpenOrders.allowed, false)
assert.equal(diagOpenOrders.reason, 'OPEN_ORDERS')
assert.equal(diagOpenOrders.openOrdersCount, 1)
console.log('TEST_2_OPEN_ORDERS_BLOCKED=PASS')

// ==============================================================================
// TEST 3: Pending Queue -> BLOCKED (PENDING_SYNC)
// ==============================================================================
const pendingQueueResult = {
  ...sampleResult,
  allowed: false,
  pendingQueue: 2,
  sales: { ...sampleResult.sales, allowed: false },
  salesReconciliation: { ...sampleResult.salesReconciliation, allowed: false, pendingQueue: 2 },
  queue: { pendingCount: 2, pendingSaleWriteCount: 2, pendingVoidUpdateCount: 0, activePendingQueueCount: 2 },
  reason: 'PENDING_SYNC',
  message: 'يوجد طلب غير مثبت لهذا اليوم. أعد المحاولة أو انسخ تقرير الخطأ.',
}
const diagPendingQueue = buildPreCloseDiagnostic({
  requestId: 103,
  operationalDay: day,
  result: pendingQueueResult,
  state: PRE_CLOSE_STATE.BLOCKED,
  loading: false,
  allowed: false,
})
assert.equal(diagPendingQueue.allowed, false)
assert.equal(diagPendingQueue.reason, 'PENDING_SYNC')
assert.equal(diagPendingQueue.pendingQueue, 2)
console.log('TEST_3_PENDING_QUEUE_BLOCKED=PASS')

// ==============================================================================
// TEST 4: Central Day Unavailable -> BLOCKED (CENTRAL_DAY_UNAVAILABLE)
// ==============================================================================
const noCentralDayResult = {
  ...sampleResult,
  allowed: false,
  centralDay: null,
  reason: 'CENTRAL_DAY_UNAVAILABLE',
  message: 'تعذر قراءة حالة اليوم المركزي.',
}
const diagNoDay = buildPreCloseDiagnostic({
  requestId: 104,
  operationalDay: day,
  result: noCentralDayResult,
  state: PRE_CLOSE_STATE.BLOCKED,
  loading: false,
  allowed: false,
})
assert.equal(diagNoDay.allowed, false)
assert.equal(diagNoDay.reason, 'CENTRAL_DAY_UNAVAILABLE')
console.log('TEST_4_CENTRAL_DAY_UNAVAILABLE_BLOCKED=PASS')

// ==============================================================================
// TEST 5: Central Sales Read Failure -> ERROR / BLOCKED (CENTRAL_SALES_READ_FAILED)
// ==============================================================================
const salesReadError = Object.assign(new Error('فشلت قراءة المبيعات من السيرفر.'), { code: 'CENTRAL_SALES_READ_FAILED' })
const diagReadError = buildPreCloseDiagnostic({
  requestId: 105,
  operationalDay: day,
  error: salesReadError,
  state: PRE_CLOSE_STATE.ERROR,
  loading: false,
  allowed: false,
})
assert.equal(diagReadError.allowed, false)
assert.equal(diagReadError.reason, 'CENTRAL_SALES_READ_FAILED')
assert.match(diagReadError.message, /فشلت قراءة المبيعات/)
console.log('TEST_5_CENTRAL_SALES_READ_FAILURE=PASS')

// ==============================================================================
// TEST 6: Financial Reconciliation Failed -> BLOCKED (FINANCIAL_RECONCILIATION_FAILED)
// ==============================================================================
const financialFailResult = {
  ...sampleResult,
  allowed: false,
  financial: { allowed: false, pendingExpenseCount: 1 },
  financialReconciliation: { allowed: false, pendingExpenseCount: 1 },
  reason: 'FINANCIAL_RECONCILIATION_FAILED',
  message: 'توجد مصاريف محلية غير متزامنة. أكمل المزامنة قبل إنهاء اليوم.',
}
const diagFinFail = buildPreCloseDiagnostic({
  requestId: 106,
  operationalDay: day,
  result: financialFailResult,
  state: PRE_CLOSE_STATE.BLOCKED,
  loading: false,
  allowed: false,
})
assert.equal(diagFinFail.allowed, false)
assert.equal(diagFinFail.reason, 'FINANCIAL_RECONCILIATION_FAILED')
console.log('TEST_6_FINANCIAL_RECONCILIATION_FAILED=PASS')

// ==============================================================================
// TEST 7: Race Conditions
// Request 1 starts -> Request 2 starts -> Request 2 finishes -> Request 1 finishes -> Request 2 wins!
// ==============================================================================
let currentRequestId = 0
let appState = null

// R1 starts
const r1Id = ++currentRequestId
let r1Result = { allowed: false, message: 'R1 result' }

// R2 starts before R1 finishes
const r2Id = ++currentRequestId
let r2Result = { allowed: true, message: 'R2 result' }

// R2 finishes first
if (isCurrentPreCloseRequest(r2Id, currentRequestId)) {
  appState = completePreCloseCheck(r2Result)
}
assert.equal(appState.allowed, true)
assert.equal(appState.message, 'R2 result')

// R1 finishes later
if (isCurrentPreCloseRequest(r1Id, currentRequestId)) {
  appState = completePreCloseCheck(r1Result)
}
// State MUST remain R2's state (allowed: true, message: 'R2 result')
assert.equal(appState.allowed, true, 'R1 must NOT overwrite R2')
assert.equal(appState.message, 'R2 result')
console.log('TEST_7_RACE_R2_FINISHES_FIRST_R2_WINS=PASS')

// ==============================================================================
// TEST 8: Race Condition: R1 finishes first -> R2 finishes later -> R2 wins
// ==============================================================================
currentRequestId = 0
appState = null

// R1 starts & finishes
const req1 = ++currentRequestId
appState = completePreCloseCheck({ allowed: false, message: 'First check blocked' })
assert.equal(appState.allowed, false)

// R2 starts & finishes
const req2 = ++currentRequestId
appState = completePreCloseCheck({ allowed: true, message: 'Second check allowed' })
assert.equal(appState.allowed, true)
console.log('TEST_8_RACE_SEQUENTIAL_LATEST_WINS=PASS')

console.log('ALL_PRE_CLOSE_ARCHITECTURE_TESTS=PASS')
