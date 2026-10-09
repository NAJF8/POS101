import { isCashboxExpense, isManagementExpense, isWithdrawalExpense, isRegularExpense, normalizeExpense } from './expenseReporting.js'

export const toMoneyNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
export const hasActualCash = value => {
  if (value === null || value === undefined || String(value).trim() === '') return false
  return Number.isFinite(Number(value))
}
const amount = value => toMoneyNumber(value, 0)
export const normalizeBusinessDate = (value, fallback = '') => {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback
}
export const resolveFinancialBusinessDate = (record, operationalDayDates = {}) => {
  const explicitCandidates = [
    record?.businessDate,
    record?.business_date,
    record?.shiftBusinessDate,
    record?.day?.businessDate,
    record?.operationalDay?.businessDate,
    record?.operational_day?.businessDate,
    record?.date,
  ]
  const explicit = explicitCandidates.map(value => normalizeBusinessDate(value)).find(Boolean)
  if (explicit) return explicit
  const operationalDayId = String(record?.operationalDayId || record?.operational_day_id || record?.shiftId || '').trim()
  const mapped = normalizeBusinessDate(operationalDayDates[operationalDayId])
  if (mapped) return mapped
  const timestamp = Number(record?.createdAt || record?.created_at || record?.date || record?.timestamp)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`
}

const invalidStatuses = new Set(['voided', 'cancelled', 'canceled', 'abandoned', 'draft', 'باطل', 'ملغي'])
const isVoided = row => invalidStatuses.has(String(row?.status || '').trim().toLowerCase()) || row?.voided === true
const isExplicitVoidedSale = row => row?.voided === true || String(row?.status || '').trim().toLowerCase() === 'voided' || row?.status === 'باطل'
const isExplicitCancelledSale = row => ['cancelled', 'canceled', 'abandoned', 'draft', 'ملغي'].includes(String(row?.status || '').trim().toLowerCase())
const saleAmount = sale => amount(sale?.total ?? sale?.subtotal)
const paymentMethod = sale => sale?.paymentMethod || sale?.payment?.method || ''

export const LEGACY_WITHDRAWAL_DEFAULT = 'cashbox'
export const normalizeFundingSource = value => value === 'management' ? 'management' : LEGACY_WITHDRAWAL_DEFAULT
export const isCashboxWithdrawal = row => row?.type === 'withdrawal' && normalizeFundingSource(row?.fundingSource) === 'cashbox'
export const isManagementWithdrawal = row => row?.type === 'withdrawal' && normalizeFundingSource(row?.fundingSource) === 'management'
export const isSettlementBookkeeping = row => row?.type === 'settlement' || row?.source === 'settlement'

export const cashAnalysisStatus = difference => difference === null || difference === undefined
  ? 'unknown'
  : difference === 0 ? 'matched' : difference < 0 ? 'short' : 'over'

// These are report-only derived values. They do not participate in the
// expected-cash calculation, which remains opening + dailyCashMovement.
export const calculateEndDayCashAnalysis = ({ openingCashBalance, cashSales = 0, expenses = 0, withdrawals = 0, expectedCash = null, actualCash = null } = {}) => {
  const openingKnown = openingCashBalance !== null && openingCashBalance !== undefined && openingCashBalance !== '' && Number.isFinite(Number(openingCashBalance))
  const actualKnown = hasActualCash(actualCash)
  const opening = toMoneyNumber(openingCashBalance, 0)
  const actual = actualKnown ? toMoneyNumber(actualCash, 0) : null
  const difference = actualKnown && Number.isFinite(Number(expectedCash)) ? actual - toMoneyNumber(expectedCash, 0) : null
  const netDrawerMovement = actualKnown && openingKnown ? actual - opening : null
  const netCashSalesFromDrawer = netDrawerMovement === null ? null : netDrawerMovement + amount(expenses) + amount(withdrawals)
  const cashSalesDifference = netCashSalesFromDrawer === null ? null : netCashSalesFromDrawer - amount(cashSales)
  return { netDrawerMovement, netCashSalesFromDrawer, cashSalesDifference, cashSalesDifferenceStatus: cashAnalysisStatus(cashSalesDifference), actualCash: actual, difference }
}

export const calculateCashboxBalance = transactions => (Array.isArray(transactions) ? transactions : []).reduce((balance, transaction) => {
  if (isVoided(transaction)) return balance
  const value = amount(transaction?.amount)
  if (['deposit', 'return'].includes(transaction?.type)) return balance + value
  if (transaction?.type === 'withdrawal') return isCashboxWithdrawal(transaction) ? balance - value : balance
  if (transaction?.type === 'expense') return transaction?.fundingSource === 'management' ? balance : balance - value
  if (transaction?.type === 'adjustment') return balance + amount(transaction?.signedAmount ?? transaction?.amount)
  return balance
}, 0)

export const calculateSettlement = ({ sales = [], expenses = [], transactions = [], openingCashBalance } = {}) => {
  const validSales = sales.filter(sale => !isVoided(sale))
  const cashSales = validSales.filter(sale => paymentMethod(sale) === 'cash').reduce((sum, sale) => sum + saleAmount(sale), 0)
  const electronicSales = validSales.filter(sale => paymentMethod(sale) === 'electronic').reduce((sum, sale) => sum + saleAmount(sale), 0)
  const validExpenses = expenses.filter(expense => !isVoided(expense)).map(normalizeExpense)
  const ordinaryExpenses = validExpenses.filter(isRegularExpense)
  const cashboxExpenses = ordinaryExpenses.filter(isCashboxExpense).reduce((sum, expense) => sum + amount(expense?.amount), 0)
  const managementExpenses = ordinaryExpenses.filter(isManagementExpense).reduce((sum, expense) => sum + amount(expense?.amount), 0)
  const expenseTotal = cashboxExpenses + managementExpenses
  const movementTransactions = transactions.filter(row => !isSettlementBookkeeping(row))
  const withdrawalRows = movementTransactions.filter(row => row?.type === 'withdrawal' && !isVoided(row))
  const linkedWithdrawalExpenseIds = new Set(withdrawalRows.map(row => String(row?.linkedExpenseId || row?.sourceRefId || '')).filter(Boolean))
  const derivedWithdrawals = validExpenses.filter(isWithdrawalExpense).filter(row => !linkedWithdrawalExpenseIds.has(String(row.id || '')))
  const cashboxWithdrawals = withdrawalRows.filter(isCashboxWithdrawal).reduce((sum, row) => sum + amount(row.amount), 0)
    + derivedWithdrawals.filter(isCashboxExpense).reduce((sum, row) => sum + amount(row.amount), 0)
  const managementWithdrawals = withdrawalRows.filter(isManagementWithdrawal).reduce((sum, row) => sum + amount(row.amount), 0)
  const withdrawals = cashboxWithdrawals + managementWithdrawals
  const deposits = movementTransactions.filter(row => row?.type === 'deposit' && !isVoided(row)).reduce((sum, row) => sum + amount(row.amount), 0)
  const adjustments = movementTransactions.filter(row => row?.type === 'adjustment' && !isVoided(row)).reduce((sum, row) => sum + amount(row.signedAmount ?? row.amount), 0)
  const dailyCashMovement = cashSales + deposits - cashboxExpenses - cashboxWithdrawals + adjustments
  const openingKnown = openingCashBalance !== null && openingCashBalance !== undefined && openingCashBalance !== '' && Number.isFinite(Number(openingCashBalance))
  const openingValue = openingKnown ? Number(openingCashBalance) : 0
  const expectedClosingCash = openingValue + dailyCashMovement
  return { sales: validSales.reduce((sum, sale) => sum + saleAmount(sale), 0), cashSales, electronicSales, expenses: expenseTotal, cashboxExpenses, managementExpenses, withdrawals, cashboxWithdrawals, managementWithdrawals, deposits, adjustments, dailyCashMovement, openingCashBalance: openingKnown ? openingValue : null, openingCashBalanceOrZero: openingValue, openingCashKnown: openingKnown, expectedCash: expectedClosingCash, expectedClosingCash, finalAfterAllSettlements: expectedClosingCash, finalNetSaleWithoutOpening: cashSales + electronicSales - expenseTotal - withdrawals + deposits, cashOnlyNetWithoutOpening: cashSales - expenseTotal - withdrawals + deposits, orderCount: validSales.length, averageOrder: validSales.length ? (cashSales + electronicSales) / validSales.length : 0, ...calculateEndDayCashAnalysis({ openingCashBalance: openingKnown ? openingValue : null, cashSales, expenses: expenseTotal, withdrawals, expectedCash: expectedClosingCash }) }
}

export const calculateCashboxDay = ({ openingCashBalance, actualCash, sales = [], expenses = [], transactions = [] } = {}) => {
  const summary = calculateSettlement({ openingCashBalance, sales, expenses, transactions })
  const actualKnown = hasActualCash(actualCash)
  const actual = toMoneyNumber(actualCash, 0)
  const difference = actualKnown && summary.openingCashKnown ? actual - summary.expectedClosingCash : null
  return { ...summary, ...calculateEndDayCashAnalysis({ openingCashBalance, cashSales: summary.cashSales, expenses: summary.expenses, withdrawals: summary.withdrawals, expectedCash: summary.openingCashKnown ? summary.expectedCash : null, actualCash }), status: difference === null ? 'unknown' : settlementStatusForDifference(difference) }
}

export const buildCashboxReportRows = ({ operationalDays = [], settlements = [], settlementCorrections = [], sales = [], expenses = [], transactions = [] } = {}) => {
  const days = operationalDays.filter(day => day?.id).slice().sort((left, right) => Number(right.endedAt || right.startedAt || 0) - Number(left.endedAt || left.startedAt || 0))
  const byDate = new Map()
  days.forEach(day => { const list = byDate.get(day.businessDate) || []; list.push(day); byDate.set(day.businessDate, list) })
  const dayDates = Object.fromEntries(days.map(day => [String(day.id), day.businessDate]))
  const rowDayId = row => String(row?.operationalDayId || row?.operational_day_id || row?.dayId || '').trim()
  const rowsForDay = (rows, day) => rows.filter(row => {
    const explicitDate = [row?.businessDate, row?.business_date, row?.shiftBusinessDate, row?.date]
      .map(value => normalizeBusinessDate(value))
      .find(Boolean)
    if (explicitDate) return explicitDate === day.businessDate
    const dateMatches = resolveFinancialBusinessDate(row, dayDates) === day.businessDate
    const sourceDayId = rowDayId(row)
    if (sourceDayId === String(day.id)) return true
    // A recovered legacy row may have a correct businessDate but no or stale
    // operational-day key. Use the date only when the date identifies one day.
    return dateMatches && byDate.get(day.businessDate)?.length === 1
  })
  return days.map(day => {
    const settlement = settlements.find(row => String(row.operationalDayId || row.operational_day_id || '') === String(day.id)) || settlements.find(row => resolveFinancialBusinessDate(row, dayDates) === day.businessDate && (!row.operationalDayId && !row.operational_day_id || day.fallbackFromBusinessDate)) || null
    const effective = settlement ? getEffectiveSettlement(settlement, settlementCorrections.filter(row => String(row.settlementId || '') === String(settlement.id))) : null
    const isKnownMoney = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    const dayOpening = day.openingCashBalance ?? day.openingBalance
    const settlementOpening = settlement?.openingCashBalance
    // The operational-day opening is authoritative for the cashbox report.
    // A stale settlement opening of 0 must not erase a known day opening.
    const opening = isKnownMoney(dayOpening) ? Number(dayOpening) : isKnownMoney(settlementOpening) ? Number(settlementOpening) : null
    const daySales = rowsForDay(sales, day)
    const summary = calculateCashboxDay({ openingCashBalance: opening, actualCash: effective?.effectiveActualCash, sales: daySales, expenses: rowsForDay(expenses, day), transactions: rowsForDay(transactions, day) })
    const settledExpectedCash = settlement?.expectedCash ?? effective?.expectedCash
    const hasSettledExpectedCash = summary.openingCashKnown && Number.isFinite(Number(settledExpectedCash)) && Number(settledExpectedCash) >= 0
    const settledSummary = hasSettledExpectedCash && Number(summary.expectedClosingCash) !== Number(settledExpectedCash)
      ? (() => {
          const expected = Number(settledExpectedCash)
          const adjustedCashboxWithdrawals = Math.max(0, Number(summary.cashboxWithdrawals || 0) + Number(summary.expectedClosingCash || 0) - expected)
          const adjustedWithdrawals = adjustedCashboxWithdrawals + Number(summary.managementWithdrawals || 0)
          const adjustedMovement = expected - Number(summary.openingCashBalance || 0)
          return {
            ...summary,
            cashboxWithdrawals: adjustedCashboxWithdrawals,
            drawerWithdrawals: adjustedCashboxWithdrawals,
            withdrawals: adjustedWithdrawals,
            dailyCashMovement: adjustedMovement,
            expectedCash: expected,
            expectedClosingCash: expected,
            finalAfterAllSettlements: expected,
            ...calculateEndDayCashAnalysis({ openingCashBalance: summary.openingCashBalance, cashSales: summary.cashSales, expenses: summary.expenses, withdrawals: adjustedWithdrawals, expectedCash: expected, actualCash: effective?.effectiveActualCash }),
          }
        })()
      : summary
    return { day, settlement, effective, ...settledSummary, salesRecordsMatched: settledSummary.orderCount, salesCashTotal: settledSummary.cashSales, salesElectronicTotal: settledSummary.electronicSales, drawerExpenses: settledSummary.cashboxExpenses, drawerWithdrawals: settledSummary.cashboxWithdrawals, excludedVoidedSalesCount: daySales.filter(isExplicitVoidedSale).length, excludedCancelledSalesCount: daySales.filter(isExplicitCancelledSale).length, rolloverCash: effective ? effective.effectiveActualCash : null, hasSettlement: Boolean(settlement) }
  })
}

// One report-only dataset for the cashbox screen and its printed DOM. It uses
// the same businessDate-filtered day rows for cards, daily detail, and history.
export const buildCashboxReportData = ({ from = '', to = '', operationalDays = [], settlements = [], settlementCorrections = [], sales = [], expenses = [], transactions = [] } = {}) => {
  const inRange = row => { const date = resolveFinancialBusinessDate(row); return date && date >= from && date <= to }
  const dates = new Set([...sales, ...expenses, ...transactions].filter(inRange).map(resolveFinancialBusinessDate))
  const sourceDays = (Array.isArray(operationalDays) ? operationalDays : []).filter(day => day?.businessDate >= from && day?.businessDate <= to)
  const knownDates = new Set(sourceDays.map(day => day.businessDate))
  const daysById = new Map((Array.isArray(operationalDays) ? operationalDays : []).filter(day => day?.id).map(day => [String(day.id), day]))
  const settlementDate = settlement => resolveFinancialBusinessDate(settlement, Object.fromEntries([...daysById.entries()].map(([id, day]) => [id, day.businessDate])))
  settlements.filter(row => {
    const date = settlementDate(row)
    return date && date >= from && date <= to
  }).forEach(row => dates.add(settlementDate(row)))
  const fallbackDays = [...dates].filter(date => !knownDates.has(date)).map(date => {
    const settlement = settlements.find(row => settlementDate(row) === date && row?.openingCashBalance !== undefined && row?.openingCashBalance !== null) || null
    const sourceDay = (Array.isArray(operationalDays) ? operationalDays : []).find(day => day?.businessDate === date) || null
    const opening = sourceDay?.openingCashBalance ?? sourceDay?.openingBalance ?? settlement?.openingCashBalance
    return { id: `business-date:${date}`, businessDate: date, status: 'fallback', fallbackFromBusinessDate: true, openingCashBalance: opening, openingSource: sourceDay?.openingCashBalance !== undefined ? 'operationalDay' : settlement ? 'settlement' : null }
  })
  const rows = buildCashboxReportRows({ operationalDays: [...sourceDays, ...fallbackDays], settlements, settlementCorrections, sales, expenses, transactions })
  const dailyRows = rows.map(row => ({ businessDate: row.day.businessDate, sales: row.sales, cash: row.cashSales, electronic: row.electronicSales, expenses: row.cashboxExpenses, withdrawals: row.cashboxWithdrawals, deposits: row.deposits, net: row.openingCashKnown ? row.expectedClosingCash : row.cashSales - row.cashboxExpenses - row.cashboxWithdrawals + row.deposits, expectedCash: row.openingCashKnown ? row.expectedClosingCash : null, openingCashBalance: row.openingCashBalance, orders: row.orderCount, fallbackFromBusinessDate: Boolean(row.day.fallbackFromBusinessDate), openingSource: row.day.openingSource || (row.day.fallbackFromBusinessDate ? 'businessDateFallback' : 'operationalDay') }))
  const selected = from === to ? rows.find(row => row.day.businessDate === from) || null : null
  const chronological = rows.slice().sort((left, right) => String(left.day.businessDate).localeCompare(String(right.day.businessDate)))
  const firstKnownOpening = chronological.find(row => row.openingCashKnown)
  const aggregate = chronological.length ? chronological.reduce((summary, row) => ({
    ...summary,
    sales: summary.sales + row.sales,
    cashSales: summary.cashSales + row.cashSales,
    electronicSales: summary.electronicSales + row.electronicSales,
    expenses: summary.expenses + row.expenses,
    cashboxExpenses: summary.cashboxExpenses + row.cashboxExpenses,
    managementExpenses: summary.managementExpenses + row.managementExpenses,
    withdrawals: summary.withdrawals + row.withdrawals,
    cashboxWithdrawals: summary.cashboxWithdrawals + row.cashboxWithdrawals,
    managementWithdrawals: summary.managementWithdrawals + row.managementWithdrawals,
    deposits: summary.deposits + row.deposits,
    orderCount: summary.orderCount + row.orderCount,
    dailyCashMovement: summary.dailyCashMovement + row.dailyCashMovement,
  }), { sales: 0, cashSales: 0, electronicSales: 0, expenses: 0, cashboxExpenses: 0, managementExpenses: 0, withdrawals: 0, cashboxWithdrawals: 0, managementWithdrawals: 0, deposits: 0, orderCount: 0, dailyCashMovement: 0 }) : null
  const summary = aggregate ? { ...aggregate, openingCashBalance: firstKnownOpening?.openingCashBalance ?? null, openingCashKnown: Boolean(firstKnownOpening?.openingCashKnown), expectedCash: firstKnownOpening?.openingCashKnown ? firstKnownOpening.openingCashBalance + aggregate.dailyCashMovement : null, expectedClosingCash: firstKnownOpening?.openingCashKnown ? firstKnownOpening.openingCashBalance + aggregate.dailyCashMovement : null } : selected
  return { rows, dailyRows, selected, operationalDays: rows.map(row => row.day), summary: selected || summary }
}
export const calculateFinancialReport = ({ sales = [], expenses = [], transactions = [], from, to } = {}) => {
  const inRange = row => { const date = resolveFinancialBusinessDate(row); return (!from || date >= from) && (!to || date <= to) }
  const filteredSales = sales.filter(inRange)
  const filteredExpenses = expenses.filter(inRange)
  const filteredTransactions = transactions.filter(inRange)
  const summary = calculateSettlement({ sales: filteredSales, expenses: filteredExpenses, transactions: filteredTransactions })
  const byDay = new Map()
  const ensure = date => { if (!byDay.has(date)) byDay.set(date, { businessDate: date, sales: 0, cash: 0, electronic: 0, expenses: 0, withdrawals: 0, deposits: 0, net: 0, orders: 0 }); return byDay.get(date) }
  filteredSales.forEach(sale => { const row = ensure(resolveFinancialBusinessDate(sale)); const value = saleAmount(sale); row.sales += value; row.orders += 1; if (paymentMethod(sale) === 'cash') row.cash += value; if (paymentMethod(sale) === 'electronic') row.electronic += value })
  const normalizedExpenses = filteredExpenses.map(normalizeExpense)
  normalizedExpenses.filter(isRegularExpense).forEach(expense => { const row = ensure(resolveFinancialBusinessDate(expense)); if (isCashboxExpense(expense)) row.expenses += amount(expense.amount) })
  filteredTransactions.forEach(transaction => { const row = ensure(resolveFinancialBusinessDate(transaction)); if (isCashboxWithdrawal(transaction)) row.withdrawals += amount(transaction.amount); if (transaction.type === 'deposit' || transaction.type === 'return') row.deposits += amount(transaction.amount) })
  const transactionExpenseIds = new Set(filteredTransactions.filter(row => row?.type === 'withdrawal').map(row => String(row.linkedExpenseId || row.sourceRefId || '')).filter(Boolean))
  normalizedExpenses.filter(isWithdrawalExpense).filter(row => !transactionExpenseIds.has(String(row.id || ''))).forEach(expense => { ensure(resolveFinancialBusinessDate(expense)).withdrawals += amount(expense.amount) })
  for (const row of byDay.values()) row.net = row.cash - row.expenses - row.withdrawals + row.deposits
  return { ...summary, daily: [...byDay.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)), filteredSales, filteredExpenses, filteredTransactions }
}

export const calculateEmployeeExpenseReport = (expenses = [], transactions = [], { from = '', to = '' } = {}) => {
  const inRange = row => { const date = resolveFinancialBusinessDate(row); return (!from || date >= from) && (!to || date <= to) }
  const linkedExpenseIds = new Set(transactions.map(row => row.linkedExpenseId).filter(Boolean))
  const rows = [...expenses.filter(row => !linkedExpenseIds.has(row.id)).map(row => ({ ...row, source: row.source || 'cashier expense', type: row.type || 'expense' })), ...transactions.filter(row => row.type === 'withdrawal' || row.type === 'expense').map(row => ({ ...row, source: row.source || `cashbox ${row.type}` }))].filter(inRange).filter(row => !isVoided(row))
  const unique = rows
  const grouped = new Map()
  unique.forEach(row => { const id = String(row.employeeId || row.cashierId || row.person || 'unknown'); const name = row.employeeNameSnapshot || row.person || row.cashierNameSnapshot || 'غير محدد'; const current = grouped.get(id) || { employeeId: id, name, total: 0, operations: 0, withdrawals: 0, cashierExpenses: 0, rows: [] }; const value = amount(row.amount); current.total += value; current.operations += 1; if (row.source === 'cashbox withdrawal') current.withdrawals += value; else current.cashierExpenses += value; current.rows.push(row); grouped.set(id, current) })
  return [...grouped.values()].sort((a, b) => b.total - a.total)
}

export const makeSettlementIdempotencyKey = operationalDayId => `settlement:${String(operationalDayId || '').trim()}`

export const settlementStatusForDifference = difference => difference === 0 ? 'matched' : difference > 0 ? 'over' : 'short'

export const calculateSettlementCorrection = ({ settlement, correctedActualCash } = {}) => {
  const expectedCash = amount(settlement?.expectedCash)
  const correctedActual = Number(correctedActualCash)
  if (!Number.isFinite(correctedActual) || correctedActual < 0) throw new Error('المبلغ الفعلي المصحح يجب أن يكون رقماً لا يقل عن صفر.')
  const correctedDifference = correctedActual - expectedCash
  return { correctedActualCash: correctedActual, correctedDifference, correctedStatus: settlementStatusForDifference(correctedDifference) }
}

export const latestActiveSettlementCorrection = (corrections = []) => corrections
  .filter(row => row?.status === 'active')
  .slice()
  .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id || '').localeCompare(String(b.id || '')))
  .at(-1) || null

export const getEffectiveSettlement = (settlement, corrections = []) => {
  const correction = latestActiveSettlementCorrection(corrections)
  if (!correction) {
    const effectiveActualCash = hasActualCash(settlement?.actualCash) ? toMoneyNumber(settlement.actualCash, 0) : null
    const effectiveDifference = effectiveActualCash === null ? null : effectiveActualCash - amount(settlement?.expectedCash)
    return { settlement, correction: null, effectiveActualCash, effectiveDifference, effectiveStatus: effectiveDifference === null ? 'unknown' : settlementStatusForDifference(effectiveDifference) }
  }
  const effectiveActualCash = amount(correction.correctedActualCash)
  const effectiveDifference = effectiveActualCash - amount(settlement?.expectedCash)
  return { settlement, correction, effectiveActualCash, effectiveDifference, effectiveStatus: settlementStatusForDifference(effectiveDifference) }
}
