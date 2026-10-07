import { isSaleSyncEligible } from './salesSyncQueue.js'

const idOf = sale => String(sale?.saleId || sale?.id || '').trim()
const operationKeyOf = sale => String(sale?.operationKey || sale?.operation_key || '').trim()
const dayIdOf = sale => String(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id || '').trim()
const identityKeys = sale => [idOf(sale) && `id:${idOf(sale)}`, operationKeyOf(sale) && `op:${operationKeyOf(sale)}`].filter(Boolean)
const belongsToDay = (sale, day) => {
  const saleDayId = dayIdOf(sale)
  return saleDayId ? saleDayId === String(day?.id || day?.operationalDayId || '').trim() : Boolean(day?.businessDate && sale?.businessDate === day.businessDate)
}

export const reconcilePreCloseSales = ({ localSales = [], queueEntries = [], centralSales = [], operationalDay = null } = {}) => {
  const centralKeys = new Set((Array.isArray(centralSales) ? centralSales : []).filter(sale => belongsToDay(sale, operationalDay)).flatMap(identityKeys))
  const localCandidates = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToDay(sale, operationalDay) && isSaleSyncEligible(sale))
  const queueCandidates = (Array.isArray(queueEntries) ? queueEntries : []).map(entry => entry?.sale).filter(sale => belongsToDay(sale, operationalDay) && isSaleSyncEligible(sale))
  const missingLocal = localCandidates.filter(sale => !identityKeys(sale).some(key => centralKeys.has(key)))
  const missingQueue = queueCandidates.filter(sale => !identityKeys(sale).some(key => centralKeys.has(key)))
  return {
    localCompletedCount: localCandidates.length,
    queuePendingCompletedCount: queueCandidates.length,
    centralCompletedCount: centralKeys.size,
    missingLocal,
    missingQueue,
    pendingQueue: queueCandidates.length,
    allowed: missingLocal.length === 0 && missingQueue.length === 0 && queueCandidates.length === 0,
  }
}
