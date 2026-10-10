import { isSaleSyncEligible, isVoidedSale, salePayloadMatches, quarantineStaleSaleQueueEntries } from './salesSyncQueue.js'

const idOf = sale => String(sale?.saleId || sale?.id || '').trim()
const operationKeyOf = sale => String(sale?.operationKey || sale?.operation_key || '').trim()
const dayIdOf = sale => String(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id || '').trim()
const identityKeys = sale => [idOf(sale) && `id:${idOf(sale)}`, operationKeyOf(sale) && `op:${operationKeyOf(sale)}`].filter(Boolean)
const belongsToCurrentDay = (sale, day) => Boolean(day?.id && day?.businessDate && dayIdOf(sale) === String(day.id || day.operationalDayId || '').trim() && String(sale?.businessDate || '') === String(day.businessDate))
const pendingMessage = ({ openOrderCount, pendingQueue, saleEngineState }) => openOrderCount > 0
  ? 'يوجد طلب مفتوح، أكمله أو ألغِه قبل إنهاء اليوم.'
  : ['BUILDING', 'WRITING_FIREBASE', 'READING_BACK'].includes(saleEngineState)
    ? 'يوجد طلب غير مثبت لهذا اليوم. أعد المحاولة أو انسخ تقرير الخطأ.'
    : pendingQueue > 0 ? 'يوجد طلب غير مثبت لهذا اليوم. أعد المحاولة أو انسخ تقرير الخطأ.' : ''

const currentRetryFromStorage = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('pos101.currentSaleRetry') : null
    const value = raw ? JSON.parse(raw) : null
    return value?.sale && typeof value.sale === 'object' ? value.sale : null
  } catch { return null }
}

const clearVerifiedRetry = sale => {
  try {
    const raw = localStorage.getItem('pos101.currentSaleRetry')
    const value = raw ? JSON.parse(raw) : null
    if (value?.sale && salePayloadMatches(value.sale, sale)) {
      localStorage.removeItem('pos101.currentSaleRetry')
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-retry-resolved', { detail: { saleId: idOf(sale), operationKey: operationKeyOf(sale) } }))
    }
  } catch { /* local repair is best effort; Firebase remains authoritative */ }
}

const quarantineStaleRetry = (sale, operationalDay) => {
  if (!sale || !operationalDay?.id || !operationalDay?.businessDate) return false
  try {
    const existingRaw = localStorage.getItem('pos101.queueQuarantine')
    const existing = existingRaw ? JSON.parse(existingRaw) : []
    const record = {
      originalQueueId: idOf(sale) || operationKeyOf(sale),
      saleId: idOf(sale),
      operationKey: operationKeyOf(sale),
      orderNumber: sale?.orderNumber ?? '',
      businessDate: String(sale?.businessDate || ''),
      operationalDayId: dayIdOf(sale),
      reason: 'STALE_RETRY_OLD_OPERATIONAL_DAY',
      quarantinedAt: Date.now(),
      rawRetryPayload: sale,
    }
    const rows = Array.isArray(existing) ? existing : []
    const duplicate = rows.some(row => row?.reason === record.reason && row?.saleId === record.saleId && row?.operationKey === record.operationKey)
    if (!duplicate) localStorage.setItem('pos101.queueQuarantine', JSON.stringify([...rows, record]))
    const raw = localStorage.getItem('pos101.currentSaleRetry')
    const value = raw ? JSON.parse(raw) : null
    if (value?.sale && idOf(value.sale) === idOf(sale) && operationKeyOf(value.sale) === operationKeyOf(sale)) localStorage.removeItem('pos101.currentSaleRetry')
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-retry-resolved', { detail: { saleId: idOf(sale), operationKey: operationKeyOf(sale) } }))
    return true
  } catch { return false }
}

export const reconcilePreCloseSales = ({ localSales = [], queueEntries = [], voidQueueEntries = [], centralSales = [], operationalDay = null, openOrderCount = 0, saleEngineState = '' } = {}) => {
  const centralRows = Array.isArray(centralSales) ? centralSales : []
  const centralKeys = new Set(centralRows.filter(sale => belongsToCurrentDay(sale, operationalDay)).flatMap(identityKeys))
  const retrySale = currentRetryFromStorage()
  const retryIsCurrent = retrySale && belongsToCurrentDay(retrySale, operationalDay)
  const retryIsVerified = retryIsCurrent && centralRows.some(remote => salePayloadMatches(retrySale, remote))
  if (retryIsVerified) clearVerifiedRetry(retrySale)
  const staleRetryQuarantined = Boolean(retrySale && !retryIsCurrent && quarantineStaleRetry(retrySale, operationalDay))
  const localCandidates = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay) && isSaleSyncEligible(sale))
  const queueCandidates = (Array.isArray(queueEntries) ? queueEntries : []).map(entry => entry?.sale).filter(sale => belongsToCurrentDay(sale, operationalDay) && operationKeyOf(sale) && isSaleSyncEligible(sale))
  // Central legacy rows may have a pending syncStatus or incomplete day metadata.
  // The local current-day sale is the scope gate; exact id/fingerprint readback is
  // the verification gate. Do not let stale metadata create a close blocker.
  const centrallyVerified = sale => centralRows.some(remote => salePayloadMatches(sale, remote))
  const missingLocal = localCandidates.filter(sale => !centrallyVerified(sale))
  const missingQueue = queueCandidates.filter(sale => !centrallyVerified(sale))
  const missingRetry = retryIsCurrent && !retryIsVerified && isSaleSyncEligible(retrySale) ? [retrySale] : []
  const localVoided = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay)
    && isVoidedSale(sale)
    && (sale?.voided === true || String(sale?.status || '').toLowerCase() === 'voided' || String(sale?.status || '').toLowerCase() === 'void_pending_sync'))
  const voidedBeforeCentral = sale => sale?.queueResolution === 'voided_before_central_sync' && sale?.centralVerified !== true
  const voidPending = localVoided.filter(sale => {
    const remote = centralRows.find(row => idOf(row) === idOf(sale) || operationKeyOf(row) === operationKeyOf(sale))
    return remote ? !isVoidedSale(remote) : !voidedBeforeCentral(sale)
  })
  const localVoidIds = new Set(voidPending.flatMap(sale => [idOf(sale), operationKeyOf(sale)].filter(Boolean)))
  const queuedVoidPending = (Array.isArray(voidQueueEntries) ? voidQueueEntries : []).filter(entry => {
    const saleId = String(entry?.saleId || '').trim()
    const remote = centralRows.find(row => idOf(row) === saleId)
    return !localVoidIds.has(saleId) && (!remote || !isVoidedSale(remote))
  })
  const activeLocal = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay) && !isVoidedSale(sale))
  const activeCentral = centralRows.filter(sale => belongsToCurrentDay(sale, operationalDay) && !isVoidedSale(sale))
  const activeTotal = rows => rows.reduce((sum, sale) => sum + Number(sale?.net ?? sale?.total ?? sale?.subtotal ?? 0), 0)
  const activeTotalsMatch = activeLocal.length === activeCentral.length && activeTotal(activeLocal) === activeTotal(activeCentral)
  const pendingKeys = new Set()
  const pendingSales = [...missingLocal, ...missingQueue, ...missingRetry].filter(sale => {
    const key = identityKeys(sale).join('|')
    if (pendingKeys.has(key)) return false
    pendingKeys.add(key)
    return true
  })
  return {
    localCompletedCount: localCandidates.length,
    queuePendingCompletedCount: queueCandidates.length,
    centralCompletedCount: centralKeys.size,
    missingLocal,
    missingQueue,
    pendingQueue: pendingSales.length + voidPending.length + queuedVoidPending.length,
    pendingVoidUpdateCount: voidPending.length + queuedVoidPending.length,
    localActiveCount: activeLocal.length,
    centralActiveCount: activeCentral.length,
    localActiveTotal: activeTotal(activeLocal),
    centralActiveTotal: activeTotal(activeCentral),
    activeTotalsMatch,
    openOrderCount: Number(openOrderCount) || 0,
    validCurrentDayPendingSyncCount: pendingSales.length + voidPending.length + queuedVoidPending.length,
    saleEngineState,
    confirmedRetryResolved: Boolean(retryIsVerified),
    staleRetryQuarantined,
    message: pendingMessage({ openOrderCount: Number(openOrderCount) || 0, pendingQueue: pendingSales.length + voidPending.length + queuedVoidPending.length, saleEngineState }) || (!activeTotalsMatch ? 'توجد فروقات بين المبيعات المحلية والمركزية.' : ''),
    allowed: (Number(openOrderCount) || 0) === 0 && !['BUILDING', 'WRITING_FIREBASE', 'READING_BACK'].includes(saleEngineState) && pendingSales.length === 0 && voidPending.length === 0 && queuedVoidPending.length === 0 && activeTotalsMatch,
  }
}

export const repairPendingQueueForEndDay = ({ centralSales = [], operationalDay = null } = {}) => quarantineStaleSaleQueueEntries({ centralSales, operationalDay })
