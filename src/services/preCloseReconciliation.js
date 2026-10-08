import { isSaleSyncEligible, isVoidedSale, salePayloadMatches } from './salesSyncQueue.js'

const idOf = sale => String(sale?.saleId || sale?.id || '').trim()
const operationKeyOf = sale => String(sale?.operationKey || sale?.operation_key || '').trim()
const dayIdOf = sale => String(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id || '').trim()
const identityKeys = sale => [idOf(sale) && `id:${idOf(sale)}`, operationKeyOf(sale) && `op:${operationKeyOf(sale)}`].filter(Boolean)
const belongsToCurrentDay = (sale, day) => Boolean(day?.id && day?.businessDate && dayIdOf(sale) === String(day.id || day.operationalDayId || '').trim() && String(sale?.businessDate || '') === String(day.businessDate))
const pendingMessage = ({ openOrderCount, pendingQueue }) => openOrderCount > 0
  ? 'يوجد طلب مفتوح، أكمله أو ألغِه قبل إنهاء اليوم.'
  : pendingQueue > 0 ? 'توجد عملية غير مكتملة، سيتم المحاولة تلقائيًا.' : ''

export const reconcilePreCloseSales = ({ localSales = [], queueEntries = [], voidQueueEntries = [], centralSales = [], operationalDay = null, openOrderCount = 0 } = {}) => {
  const centralRows = Array.isArray(centralSales) ? centralSales : []
  const centralKeys = new Set(centralRows.filter(sale => belongsToCurrentDay(sale, operationalDay)).flatMap(identityKeys))
  const localCandidates = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay) && isSaleSyncEligible(sale))
  const queueCandidates = (Array.isArray(queueEntries) ? queueEntries : []).map(entry => entry?.sale).filter(sale => belongsToCurrentDay(sale, operationalDay) && operationKeyOf(sale) && isSaleSyncEligible(sale))
  // Central legacy rows may have a pending syncStatus or incomplete day metadata.
  // The local current-day sale is the scope gate; exact id/fingerprint readback is
  // the verification gate. Do not let stale metadata create a close blocker.
  const centrallyVerified = sale => centralRows.some(remote => salePayloadMatches(sale, remote))
  const missingLocal = localCandidates.filter(sale => !centrallyVerified(sale))
  const missingQueue = queueCandidates.filter(sale => !centrallyVerified(sale))
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
  const pendingSales = [...missingLocal, ...missingQueue].filter(sale => {
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
    message: pendingMessage({ openOrderCount: Number(openOrderCount) || 0, pendingQueue: pendingSales.length + voidPending.length + queuedVoidPending.length }) || (!activeTotalsMatch ? 'توجد فروقات بين المبيعات المحلية والمركزية.' : ''),
    allowed: (Number(openOrderCount) || 0) === 0 && pendingSales.length === 0 && voidPending.length === 0 && queuedVoidPending.length === 0 && activeTotalsMatch,
  }
}
