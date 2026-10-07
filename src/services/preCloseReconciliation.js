import { isSaleSyncEligible, salePayloadMatches } from './salesSyncQueue.js'

const idOf = sale => String(sale?.saleId || sale?.id || '').trim()
const operationKeyOf = sale => String(sale?.operationKey || sale?.operation_key || '').trim()
const dayIdOf = sale => String(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id || '').trim()
const identityKeys = sale => [idOf(sale) && `id:${idOf(sale)}`, operationKeyOf(sale) && `op:${operationKeyOf(sale)}`].filter(Boolean)
const belongsToCurrentDay = (sale, day) => Boolean(day?.id && day?.businessDate && dayIdOf(sale) === String(day.id || day.operationalDayId || '').trim() && String(sale?.businessDate || '') === String(day.businessDate))
const pendingMessage = ({ openOrderCount, pendingQueue }) => openOrderCount > 0
  ? 'يوجد طلب مفتوح، أكمله أو ألغِه قبل إنهاء اليوم.'
  : pendingQueue > 0 ? 'توجد مبيعات مكتملة غير متزامنة. انتظر اكتمال المزامنة قبل إنهاء اليوم.' : ''

export const reconcilePreCloseSales = ({ localSales = [], queueEntries = [], centralSales = [], operationalDay = null, openOrderCount = 0 } = {}) => {
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
    pendingQueue: pendingSales.length,
    openOrderCount: Number(openOrderCount) || 0,
    validCurrentDayPendingSyncCount: pendingSales.length,
    message: pendingMessage({ openOrderCount: Number(openOrderCount) || 0, pendingQueue: pendingSales.length }),
    allowed: (Number(openOrderCount) || 0) === 0 && pendingSales.length === 0,
  }
}
