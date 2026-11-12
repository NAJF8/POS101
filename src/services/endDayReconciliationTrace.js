const SUMMARY_KEYS = ['count', 'gross', 'discount', 'net', 'cash', 'electronic']

const summaryOf = value => value && typeof value === 'object'
  ? Object.fromEntries(SUMMARY_KEYS.map(key => [key, value[key]]))
  : null

const failureReasonsOf = reconciliation => {
  if (!reconciliation) return ['reconciliation result unavailable']
  const reasons = []
  if (reconciliation.totalsMatch === false) reasons.push('totalsMatch=false')
  if (reconciliation.missingLocalIds?.length) reasons.push('missingLocalIds')
  if (reconciliation.missingCentralIds?.length) reasons.push('missingCentralIds')
  if (reconciliation.localSummary?.salesBalanced === false) reasons.push('local sales not balanced')
  if (reconciliation.localSummary?.paymentsBalanced === false) reasons.push('local payments not balanced')
  if (reconciliation.centralSummary?.salesBalanced === false) reasons.push('central sales not balanced')
  if (reconciliation.centralSummary?.paymentsBalanced === false) reasons.push('central payments not balanced')
  return reasons.length ? reasons : reconciliation.allowed === false ? ['allowed=false without canonical mismatch detail'] : []
}

export const recordEndDayReconciliationTrace = ({
  caller,
  localSales = [],
  centralSales = [],
  reconciliation = null,
  freshCentralSales = null,
  localSource,
  centralSource,
  exception = null,
  extra = {},
} = {}) => {
  const localSummary = summaryOf(reconciliation?.localSummary)
  const centralSummary = summaryOf(reconciliation?.centralSummary)
  const mismatchDetails = SUMMARY_KEYS
    .filter(key => localSummary && centralSummary && localSummary[key] !== centralSummary[key])
    .map(field => ({ field, local: localSummary[field], central: centralSummary[field] }))
  const trace = {
    caller,
    invocationCount: 0,
    localSnapshot: { source: localSource || 'unknown', count: Array.isArray(localSales) ? localSales.length : 0, summary: localSummary },
    centralSnapshot: { source: centralSource || 'unknown', count: Array.isArray(centralSales) ? centralSales.length : 0, summary: centralSummary },
    allowed: reconciliation?.allowed ?? null,
    failureReason: failureReasonsOf(reconciliation),
    mismatchDetails,
    missingLocalIds: reconciliation?.missingLocalIds || [],
    missingCentralIds: reconciliation?.missingCentralIds || [],
    sameFreshCentralSnapshot: freshCentralSales !== null ? centralSales === freshCentralSales : null,
    reconciliation: reconciliation ? {
      allowed: reconciliation.allowed,
      totalsMatch: reconciliation.totalsMatch,
      localSummary,
      centralSummary,
      missingLocalIds: reconciliation.missingLocalIds || [],
      missingCentralIds: reconciliation.missingCentralIds || [],
    } : null,
    exception: exception ? { name: exception.name || 'Error', message: exception.message || String(exception), stack: exception.stack || '' } : null,
    ...extra,
  }
  if (typeof window !== 'undefined') {
    const previous = Array.isArray(window.__POS101_END_DAY_RECONCILIATION_TRACE__)
      ? window.__POS101_END_DAY_RECONCILIATION_TRACE__
      : []
    trace.invocationCount = previous.length + 1
    window.__POS101_END_DAY_RECONCILIATION_TRACE__ = [...previous, trace]
  }
  if (import.meta.env?.DEV) console.info('END_DAY_RECONCILIATION_GATE', trace)
  return trace
}
