import { isSaleSyncEligible } from './salesSyncQueue.js'

const idOf = sale => String(sale?.saleId || sale?.id || '').trim()
const operationKeyOf = sale => String(sale?.operationKey || sale?.operation_key || '').trim()
const dayIdOf = sale => String(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id || '').trim()
const identityKeys = sale => [idOf(sale) && `id:${idOf(sale)}`, operationKeyOf(sale) && `op:${operationKeyOf(sale)}`].filter(Boolean)
const belongsToCurrentDay = (sale, day) => Boolean(day?.id && day?.businessDate && dayIdOf(sale) === String(day.id || day.operationalDayId || '').trim() && String(sale?.businessDate || '') === String(day.businessDate))
const pendingMessage = ({ openOrderCount, pendingQueue }) => openOrderCount > 0
  ? 'يوجد طلب مفتوح، أكمله أو ألغِه قبل إنهاء اليوم.'
  : pendingQueue > 0 ? 'توجد مبيعات مكتملة غير متزامنة. انتظر اكتمال المزامنة قبل إنهاء اليوم.' : ''

export const reconcilePreCloseSales = ({ localSales = [], queueEntries = [], centralSales = [], operationalDay = null, openOrderCount = 0 } = {}) => {
  const centralKeys = new Set((Array.isArray(centralSales) ? centralSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay)).flatMap(identityKeys))
  const localCandidates = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay) && isSaleSyncEligible(sale))
  const queueCandidates = (Array.isArray(queueEntries) ? queueEntries : []).map(entry => entry?.sale).filter(sale => belongsToCurrentDay(sale, operationalDay) && operationKeyOf(sale) && isSaleSyncEligible(sale))
  const missingLocal = localCandidates.filter(sale => !identityKeys(sale).some(key => centralKeys.has(key)))
  const missingQueue = queueCandidates.filter(sale => !identityKeys(sale).some(key => centralKeys.has(key)))
  return {
    localCompletedCount: localCandidates.length,
    queuePendingCompletedCount: queueCandidates.length,
    centralCompletedCount: centralKeys.size,
    missingLocal,
    missingQueue,
    pendingQueue: missingQueue.length,
    openOrderCount: Number(openOrderCount) || 0,
    validCurrentDayPendingSyncCount: missingQueue.length,
    message: pendingMessage({ openOrderCount: Number(openOrderCount) || 0, pendingQueue: missingQueue.length }),
    allowed: (Number(openOrderCount) || 0) === 0 && missingQueue.length === 0,
  }
}
