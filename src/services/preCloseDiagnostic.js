const numberOrZero = value => Number.isFinite(Number(value)) ? Number(value) : 0

const countOf = value => Array.isArray(value) ? value.length : numberOrZero(value)

const failureReasonOf = ({ result = null, sales = {}, financial = {}, error = null } = {}) => {
  if (error) return 'RECONCILIATION_ERROR'
  if (result?.centralDay?.status === 'closed') return 'CENTRAL_DAY_CLOSED'
  if (!result?.centralDay) return result ? 'CENTRAL_DAY_UNAVAILABLE' : 'UNKNOWN'
  if (numberOrZero(sales.openOrderCount) > 0) return 'OPEN_ORDER'
  if (countOf(sales.missingLocal) > 0) return 'MISSING_LOCAL_SALE'
  if (countOf(sales.missingQueue) > 0) return 'MISSING_QUEUE_SALE'
  if (numberOrZero(sales.pendingVoidUpdateCount) > 0 || numberOrZero(sales.voidPending) > 0 || numberOrZero(sales.queuedVoidPending) > 0) return 'PENDING_VOID'
  if (numberOrZero(sales.localActiveCount) !== numberOrZero(sales.centralActiveCount)) return 'SALES_COUNT_MISMATCH'
  if (numberOrZero(sales.localActiveTotal) !== numberOrZero(sales.centralActiveTotal)) return 'SALES_TOTAL_MISMATCH'
  if (numberOrZero(financial.pendingExpenseCount) > 0 || countOf(financial.pendingExpenses) > 0) return 'FINANCIAL_PENDING'
  if (numberOrZero(financial.unresolvedExpenseCount) > 0) return 'FINANCIAL_UNRESOLVED'
  if (numberOrZero(financial.pendingWithdrawals) > 0) return 'FINANCIAL_PENDING_WITHDRAWAL'
  return result?.allowed === false ? 'UNKNOWN' : ''
}

export const buildPreCloseDiagnostic = ({ requestId = null, operationalDay = null, result = null, state = 'unknown', loading = false, allowed = null, error = null } = {}) => {
  const sales = result?.salesReconciliation || result?.sales || {}
  const financial = result?.financialReconciliation || result?.financial || {}
  const localSalesCount = numberOrZero(sales.localActiveCount ?? sales.localCompletedCount)
  const centralSalesCount = numberOrZero(sales.centralActiveCount ?? sales.centralCompletedCount)
  const localSalesTotal = numberOrZero(sales.localActiveTotal)
  const centralSalesTotal = numberOrZero(sales.centralActiveTotal)
  const pendingLocalExpenses = numberOrZero(financial.pendingExpenseCount ?? countOf(financial.pendingExpenses))
  const unresolvedExpenses = numberOrZero(financial.unresolvedExpenseCount)
  const pendingWithdrawals = numberOrZero(financial.pendingWithdrawals)
  return {
    businessDate: String(operationalDay?.businessDate || result?.centralDay?.businessDate || ''),
    operationalDayId: String(operationalDay?.id || operationalDay?.operationalDayId || result?.centralDay?.id || ''),
    requestId,
    state,
    loading: Boolean(loading),
    allowed: Boolean(allowed ?? result?.allowed),
    salesAllowed: sales.allowed ?? null,
    financialAllowed: financial.allowed ?? null,
    localSalesCount,
    centralSalesCount,
    localSalesTotal,
    centralSalesTotal,
    countDifference: localSalesCount - centralSalesCount,
    totalDifference: localSalesTotal - centralSalesTotal,
    missingLocalCount: countOf(sales.missingLocal),
    missingQueueCount: countOf(sales.missingQueue),
    voidPending: numberOrZero(sales.voidPending ?? sales.pendingVoidUpdateCount),
    queuedVoidPending: numberOrZero(sales.queuedVoidPending),
    openOrderCount: numberOrZero(sales.openOrderCount ?? result?.openOrderCount),
    pendingLocalExpenses,
    unresolvedExpenses,
    pendingWithdrawals,
    message: String(error?.message || result?.message || ''),
    failureReason: failureReasonOf({ result, sales, financial, error }),
  }
}

export const publishPreCloseDiagnostic = payload => {
  const diagnostic = buildPreCloseDiagnostic(payload)
  if (typeof window !== 'undefined') window.__POS101_PRE_CLOSE_DIAGNOSTIC__ = diagnostic
  if (typeof console !== 'undefined') console.info('POS101_PRE_CLOSE_DIAGNOSTIC', diagnostic)
  return diagnostic
}
