import assert from 'node:assert/strict'
import { buildPreCloseDiagnostic } from '../src/services/preCloseDiagnostic.js'

const day = { id: 'day-2026-11-11', businessDate: '2026-11-11' }
const matching = buildPreCloseDiagnostic({
  requestId: 41,
  operationalDay: day,
  result: {
    allowed: true,
    centralDay: day,
    salesReconciliation: { allowed: true, localActiveCount: 15, centralActiveCount: 15, localActiveTotal: 193900, centralActiveTotal: 193900, openOrderCount: 0, missingLocal: [], missingQueue: [] },
    financialReconciliation: { allowed: true, pendingExpenseCount: 0, pendingWithdrawals: 0 },
  },
  state: 'allowed',
})
assert.equal(matching.allowed, true)
assert.equal(matching.failureReason, '')
assert.equal(matching.countDifference, 0)
assert.equal(matching.totalDifference, 0)

const missing = buildPreCloseDiagnostic({
  operationalDay: day,
  result: { allowed: false, centralDay: day, salesReconciliation: { allowed: false, localActiveCount: 15, centralActiveCount: 14, localActiveTotal: 193900, centralActiveTotal: 175900, missingLocal: [], missingQueue: [{ saleId: 'hidden-from-diagnostic' }], openOrderCount: 0 }, financialReconciliation: { allowed: true } },
  state: 'blocked',
})
assert.equal(missing.failureReason, 'MISSING_QUEUE_SALE')
assert.equal(missing.missingQueueCount, 1)
assert.equal(JSON.stringify(missing).includes('hidden-from-diagnostic'), false)

const financial = buildPreCloseDiagnostic({
  operationalDay: day,
  result: { allowed: false, centralDay: day, salesReconciliation: { allowed: true, localActiveCount: 15, centralActiveCount: 15, localActiveTotal: 193900, centralActiveTotal: 193900 }, financialReconciliation: { allowed: false, pendingExpenseCount: 1, pendingWithdrawals: 0 } },
  state: 'blocked',
})
assert.equal(financial.failureReason, 'FINANCIAL_PENDING')

const error = buildPreCloseDiagnostic({ requestId: 42, operationalDay: day, state: 'error', error: Object.assign(new Error('read failed'), { code: 'READ_FAILED' }) })
assert.equal(error.loading, false)
assert.equal(error.allowed, false)
assert.equal(error.failureReason, 'RECONCILIATION_ERROR')
assert.equal(error.message, 'read failed')

console.log('PRE_CLOSE_DIAGNOSTIC_MATCHING=PASS')
console.log('PRE_CLOSE_DIAGNOSTIC_MISMATCH_REASON=PASS')
console.log('PRE_CLOSE_DIAGNOSTIC_FINANCIAL_REASON=PASS')
console.log('PRE_CLOSE_DIAGNOSTIC_ERROR_REASON=PASS')
