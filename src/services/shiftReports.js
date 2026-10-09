import { isActiveExpense, isCashboxExpense, isRegularExpense, isWithdrawalExpense, normalizeExpense } from './expenseReporting.js'

const amount = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const text = value => String(value ?? '').trim()
const saleIsVoided = sale => sale?.status === 'voided' || sale?.voided === true || sale?.status === 'cancelled' || sale?.cancelled === true
const saleShiftType = sale => {
  const explicit = text(sale?.shiftType || sale?.shift_type).toLowerCase()
  if (explicit === 'morning' || explicit === 'evening') return { value: explicit, inferred: false }
  const shift = text(sale?.shiftId || sale?.shift_id || sale?.shift || sale?.shiftName).toLowerCase()
  if (shift.includes('evening') || shift.includes('مساء') || shift.includes('مسائي')) return { value: 'evening', inferred: false }
  if (shift.includes('morning') || shift.includes('صباح') || shift.includes('صباحي')) return { value: 'morning', inferred: false }
  const timestamp = amount(sale?.createdAt || sale?.created_at || sale?.timestamp || sale?.date)
  const date = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', hour: '2-digit', hour12: false }).format(new Date(date)))
  return { value: hour < 15 ? 'morning' : 'evening', inferred: true }
}

const expenseShiftType = expense => {
  const explicit = text(expense?.shiftType || expense?.shift_type).toLowerCase()
  if (explicit === 'morning' || explicit === 'evening') return { value: explicit, inferred: false }
  const shift = text(expense?.shiftId || expense?.shift_id || expense?.shift || expense?.shiftName).toLowerCase()
  if (shift.includes('evening') || shift.includes('مساء') || shift.includes('مسائي')) return { value: 'evening', inferred: false }
  if (shift.includes('morning') || shift.includes('صباح') || shift.includes('صباحي')) return { value: 'morning', inferred: false }
  const timestamp = amount(expense?.createdAt || expense?.created_at || expense?.timestamp || expense?.date)
  const date = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', hour: '2-digit', hour12: false }).format(new Date(date)))
  return { value: hour < 15 ? 'morning' : 'evening', inferred: true }
}

const paymentOf = sale => text(sale?.paymentMethod || sale?.payment?.method).toLowerCase()
const transactionType = row => text(row?.type || row?.transactionType || row?.movementType).toLowerCase()
const rowShiftType = row => expenseShiftType(row)

export const buildShiftReport = ({ sales = [], expenses = [], transactions = [], businessDate = '', operationalDayId = '', shiftType } = {}) => {
  const daySales = (Array.isArray(sales) ? sales : []).filter(sale => {
    if (businessDate && text(sale?.businessDate) !== text(businessDate)) return false
    if (operationalDayId && text(sale?.operationalDayId || sale?.operational_day_id) !== text(operationalDayId)) return false
    return true
  })
  const dayExpenses = (Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row)).filter(expense => {
    if (businessDate && text(expense?.businessDate) !== text(businessDate)) return false
    if (operationalDayId && text(expense?.operationalDayId) !== text(operationalDayId)) return false
    return isActiveExpense(expense)
  })
  const shiftSales = daySales.filter(sale => saleShiftType(sale).value === shiftType)
  const shiftExpenses = dayExpenses.filter(expense => expenseShiftType(expense).value === shiftType)
  const shiftTransactions = (Array.isArray(transactions) ? transactions : []).filter(row => {
    if (businessDate && text(row?.businessDate) !== text(businessDate)) return false
    if (operationalDayId && text(row?.operationalDayId || row?.operational_day_id) !== text(operationalDayId)) return false
    return row?.status !== 'voided' && !row?.voided && transactionType(row) === 'withdrawal' && rowShiftType(row).value === shiftType
  })
  const linkedExpenseIds = new Set(shiftTransactions.map(row => text(row?.linkedExpenseId || row?.sourceRefId)).filter(Boolean))
  const withdrawalRows = [...shiftTransactions, ...shiftExpenses.filter(isWithdrawalExpense).filter(row => !linkedExpenseIds.has(text(row.id)))]
  const calculatedSales = shiftSales.map(sale => ({ ...sale, inferredShiftType: saleShiftType(sale).inferred }))
  const calculatedExpenses = shiftExpenses.map(expense => ({ ...expense, inferredShiftType: expenseShiftType(expense).inferred }))
  const activeSales = calculatedSales.filter(sale => !saleIsVoided(sale))
  const cashSales = activeSales.filter(sale => paymentOf(sale) === 'cash').reduce((sum, sale) => sum + amount(sale.total ?? sale.subtotal), 0)
  const electronicSales = activeSales.filter(sale => paymentOf(sale) === 'electronic').reduce((sum, sale) => sum + amount(sale.total ?? sale.subtotal), 0)
  const totalSales = activeSales.reduce((sum, sale) => sum + amount(sale.total ?? sale.subtotal), 0)
  const discounts = activeSales.reduce((sum, sale) => sum + amount(sale.discount), 0)
  const drawerExpenses = shiftExpenses.filter(isRegularExpense).filter(isCashboxExpense).filter(expense => expense.status !== 'voided' && !expense.voided).reduce((sum, expense) => sum + amount(expense.amount), 0)
  const withdrawalsTotal = withdrawalRows.reduce((sum, row) => sum + amount(row.amount), 0)
  const voidedCount = shiftSales.filter(saleIsVoided).length
  const times = [...shiftSales, ...shiftExpenses, ...shiftTransactions].map(row => amount(row.createdAt || row.created_at || row.timestamp || row.date)).filter(Boolean)
  return {
    shiftType,
    shiftLabel: shiftType === 'morning' ? 'صباحي' : 'مسائي',
    sales: activeSales,
    expenses: calculatedExpenses,
    withdrawals: withdrawalRows,
    inferredShiftType: [...calculatedSales, ...calculatedExpenses].some(row => row.inferredShiftType === true),
    ordersCount: activeSales.length,
    totalSales,
    cashSales,
    electronicSales,
    discounts,
    drawerExpenses,
    withdrawalsTotal,
    netCash: cashSales - drawerExpenses - withdrawalsTotal,
    voidedCount,
    cashierNames: [...new Set([...shiftSales, ...shiftExpenses, ...withdrawalRows].map(row => text(row.cashierNameSnapshot || row.cashierName || row.seller || row.person || row.employeeNameSnapshot)).filter(Boolean))],
    timeRange: times.length ? { from: Math.min(...times), to: Math.max(...times) } : { from: null, to: null },
  }
}

export const buildEndDayShiftReport = ({ sales = [], expenses = [], transactions = [], businessDate = '', operationalDayId = '', openingCashBalance = null } = {}) => {
  const morning = buildShiftReport({ sales, expenses, transactions, businessDate, operationalDayId, shiftType: 'morning' })
  const evening = buildShiftReport({ sales, expenses, transactions, businessDate, operationalDayId, shiftType: 'evening' })
  const dayTransactions = (Array.isArray(transactions) ? transactions : []).filter(row => (!businessDate || text(row.businessDate) === text(businessDate)) && (!operationalDayId || text(row.operationalDayId || row.operational_day_id) === text(operationalDayId)) && row.status !== 'voided' && !row.voided)
  const withdrawals = morning.withdrawalsTotal + evening.withdrawalsTotal
  const deposits = dayTransactions.filter(row => transactionType(row) === 'deposit' || transactionType(row) === 'return').reduce((sum, row) => sum + amount(row.amount), 0)
  const expectedFinalDrawer = openingCashBalance == null ? null : amount(openingCashBalance) + morning.cashSales + evening.cashSales - morning.drawerExpenses - evening.drawerExpenses - withdrawals + deposits
  return { morning, evening, totalSales: morning.totalSales + evening.totalSales, cashSales: morning.cashSales + evening.cashSales, electronicSales: morning.electronicSales + evening.electronicSales, discounts: morning.discounts + evening.discounts, expenses: morning.drawerExpenses + evening.drawerExpenses, withdrawals, deposits, expectedFinalDrawer }
}
