const numberOrZero = value => Number.isFinite(Number(value)) ? Number(value) : 0

const countOf = value => Array.isArray(value) ? value.length : numberOrZero(value)

const failureReasonOf = ({ result = null, sales = {}, canonical = {}, financial = {}, error = null } = {}) => {
  if (error) {
    if (error?.code === 'CENTRAL_SALES_READ_FAILED') return 'CENTRAL_SALES_READ_FAILED'
    if (error?.code === 'CENTRAL_DAY_UNAVAILABLE') return 'CENTRAL_DAY_UNAVAILABLE'
    if (error?.code === 'AUTHORIZATION_FAILED') return 'AUTHORIZATION_FAILED'
    if (error?.code === 'STALE_SYNC_LOCK') return 'STALE_SYNC_LOCK'
    return 'RECONCILIATION_ERROR'
  }
  if (result?.reason) return result.reason
  if (result?.centralDay?.status === 'closed') return 'CENTRAL_DAY_CLOSED'
  if (!result?.centralDay) return result ? 'CENTRAL_DAY_UNAVAILABLE' : 'UNKNOWN'
  if (numberOrZero(sales.openOrdersCount ?? sales.openOrderCount ?? result?.openOrdersCount ?? result?.openOrderCount) > 0) return 'OPEN_ORDERS'
  if (countOf(sales.missingLocal) > 0) return 'MISSING_LOCAL_SALE'
  if (countOf(sales.missingQueue) > 0) return 'MISSING_QUEUE_SALE'
  if (numberOrZero(sales.pendingVoidUpdateCount) > 0 || numberOrZero(sales.voidPending) > 0 || numberOrZero(sales.queuedVoidPending) > 0) return 'PENDING_VOID'
  if (numberOrZero(sales.localActiveCount) !== numberOrZero(sales.centralActiveCount)) return 'LOCAL_CENTRAL_SALES_COUNT_MISMATCH'
  if (numberOrZero(sales.localActiveTotal) !== numberOrZero(sales.centralActiveTotal)) return 'LOCAL_CENTRAL_SALES_TOTAL_MISMATCH'
  if (canonical.allowed === false || (canonical.discountDifference !== undefined && canonical.discountDifference !== 0)) {
    if (canonical.discountDifference !== 0 && canonical.discountDifference !== undefined) return 'DISCOUNT_MISMATCH'
    return 'CENTRAL_SALES_CANONICAL_MISMATCH'
  }
  if (numberOrZero(financial.pendingExpenseCount) > 0 || countOf(financial.pendingExpenses) > 0) return 'FINANCIAL_PENDING'
  if (numberOrZero(financial.unresolvedExpenseCount) > 0) return 'FINANCIAL_UNRESOLVED'
  if (numberOrZero(financial.pendingWithdrawals) > 0) return 'FINANCIAL_PENDING_WITHDRAWAL'
  if (financial.allowed === false) return 'FINANCIAL_RECONCILIATION_FAILED'
  return result?.allowed === false ? 'UNKNOWN' : ''
}

export const buildPreCloseDiagnostic = ({ requestId = null, operationalDay = null, result = null, state = 'unknown', loading = false, allowed = null, error = null } = {}) => {
  const sales = result?.salesReconciliation || result?.sales || {}
  const canonical = result?.canonicalSalesReconciliation || result?.canonical || {}
  const financial = result?.financialReconciliation || result?.financial || {}
  const queue = result?.queue || {}

  const localSalesCount = numberOrZero(sales.localActiveCount ?? sales.localCompletedCount ?? canonical.localCount)
  const centralSalesCount = numberOrZero(sales.centralActiveCount ?? sales.centralCompletedCount ?? canonical.centralCount)
  const localSalesTotal = numberOrZero(sales.localActiveTotal ?? canonical.localNet)
  const centralSalesTotal = numberOrZero(sales.centralActiveTotal ?? canonical.centralNet)

  const localDiscount = numberOrZero(canonical.localDiscount ?? canonical.localSummary?.discount)
  const centralDiscount = numberOrZero(canonical.centralDiscount ?? canonical.centralSummary?.discount)
  const discountDifference = canonical.discountDifference !== undefined
    ? numberOrZero(canonical.discountDifference)
    : localDiscount - centralDiscount

  const missingLocal = countOf(sales.missingLocal ?? canonical.missingLocalIds)
  const missingCentral = countOf(canonical.missingCentralIds)
  const missingQueueCount = countOf(sales.missingQueue)

  const pendingQueue = numberOrZero(result?.pendingQueue ?? queue.pendingCount ?? sales.pendingQueue)
  const pendingSaleWriteCount = numberOrZero(queue.pendingSaleWriteCount ?? missingQueueCount)
  const pendingVoidUpdateCount = numberOrZero(queue.pendingVoidUpdateCount ?? sales.pendingVoidUpdateCount ?? sales.voidPending)
  const activePendingQueueCount = numberOrZero(queue.activePendingQueueCount ?? result?.validCurrentDayPendingSyncCount ?? pendingQueue)
  const openOrdersCount = numberOrZero(result?.openOrdersCount ?? sales.openOrdersCount ?? sales.openOrderCount ?? result?.openOrderCount)

  const salesAllowed = sales.allowed ?? null
  const canonicalSalesAllowed = canonical.allowed ?? null
  const financialAllowed = financial.allowed ?? null
  const finalAllowed = Boolean(allowed ?? result?.allowed)

  const pendingLocalExpenses = numberOrZero(financial.pendingExpenseCount ?? countOf(financial.pendingExpenses))
  const unresolvedExpenses = numberOrZero(financial.unresolvedExpenseCount)
  const pendingWithdrawals = numberOrZero(financial.pendingWithdrawals)

  const computedReason = failureReasonOf({ result, sales, canonical, financial, error })
  const finalReason = error ? computedReason : finalAllowed ? '' : (result?.reason || computedReason)

  return {
    businessDate: String(operationalDay?.businessDate || result?.centralDay?.businessDate || ''),
    operationalDayId: String(operationalDay?.id || operationalDay?.operationalDayId || result?.centralDay?.id || ''),
    requestId,
    state,
    loading: Boolean(loading),
    allowed: finalAllowed,
    finalAllowed,
    salesAllowed,
    canonicalSalesAllowed,
    financialAllowed,
    localSalesCount,
    centralSalesCount,
    localSalesTotal,
    centralSalesTotal,
    countDifference: localSalesCount - centralSalesCount,
    totalDifference: localSalesTotal - centralSalesTotal,
    localDiscount,
    centralDiscount,
    discountDifference,
    missingLocal,
    missingCentral,
    missingLocalCount: missingLocal,
    missingQueueCount,
    pendingQueue,
    pendingSaleWriteCount,
    pendingVoidUpdateCount,
    activePendingQueueCount,
    voidPending: pendingVoidUpdateCount,
    queuedVoidPending: numberOrZero(sales.queuedVoidPending),
    openOrdersCount,
    openOrderCount: openOrdersCount,
    pendingLocalExpenses,
    unresolvedExpenses,
    pendingWithdrawals,
    reason: finalReason,
    failureReason: finalReason,
    message: String(error?.message || result?.message || ''),
  }
}

export const publishPreCloseDiagnostic = payload => {
  const diagnostic = buildPreCloseDiagnostic(payload)
  if (typeof window !== 'undefined') window.__POS101_PRE_CLOSE_DIAGNOSTIC__ = diagnostic
  if (typeof console !== 'undefined') console.info('POS101_PRE_CLOSE_DIAGNOSTIC', diagnostic)
  return diagnostic
}
