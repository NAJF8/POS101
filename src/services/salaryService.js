import { getLocalDateKey, normalizeDateKey, normalizeExpense } from './expenseReporting.js'
import { buildMoneyOutLedger } from './moneyOutClassifier.js'
import { matchEmployeeRecord, matchesEmployee } from './employeeReport.js'

export const SALARY_EXPENSE_CATEGORY = 'رواتب'
export const LEGACY_SALARY_CATEGORY = 'راتب'

export const NEW_EXPENSE_CATEGORIES = Object.freeze([
  'العصائر',
  'الحلويات',
  'القهوة',
  'الحليب',
  'رواتب'
])

export const LEGACY_EXPENSE_CATEGORIES = Object.freeze([
  'مشتريات',
  'صيانة',
  'نقل',
  'أدوات تنظيف',
  'راتب',
  'سحوبات',
  'أخرى'
])

// Preserves 'مشتريات' first and all legacy categories intact while adding the new categories
export const EXPENSE_CATEGORIES = Object.freeze([
  'مشتريات',
  'العصائر',
  'الحلويات',
  'القهوة',
  'الحليب',
  'رواتب',
  'صيانة',
  'نقل',
  'أدوات تنظيف',
  'راتب',
  'سحوبات',
  'أخرى'
])

const text = value => String(value ?? '').trim()
const amount = value => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export const isSalaryCategory = category => {
  const clean = text(category)
  return clean === SALARY_EXPENSE_CATEGORY || clean === LEGACY_SALARY_CATEGORY || clean.includes('راتب') || clean.includes('رواتب')
}

export const normalizeFixedMonthlySalary = value => {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : 0
}

export const normalizePayrollPeriod = (period, fallbackDate = '') => {
  const clean = text(period)
  if (/^\d{4}-\d{2}$/.test(clean)) return clean
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean.slice(0, 7)
  const fallback = normalizeDateKey(fallbackDate) || getLocalDateKey(Date.now())
  return fallback ? fallback.slice(0, 7) : ''
}

export const formatTimeSnapshot = timestampOrTime => {
  const raw = text(timestampOrTime)
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw
  const ms = Number.isFinite(Number(timestampOrTime)) && Number(timestampOrTime) > 0
    ? Number(timestampOrTime)
    : Date.now()
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Baghdad',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(ms))
  } catch {
    const d = new Date(ms)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

const makeTransactionId = prefix => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Creates a canonical salary payment record (stored in Expenses under 'رواتب').
 * Captures all required fields (Section 13 & 14):
 * - employeeId
 * - employeeName (snapshot)
 * - amount (actually paid amount)
 * - date (businessDate)
 * - time
 * - payrollPeriod (YYYY-MM)
 * - createdBy
 * - note
 * - transactionId
 */
export const createSalaryPaymentRecord = ({
  id,
  transactionId,
  employee,
  employeeId = '',
  employeeName = '',
  employeeCode = '',
  amount: paidAmount,
  date = '',
  businessDate = '',
  time = '',
  payrollPeriod = '',
  createdBy = '',
  createdByUid = '',
  note = '',
  fundingSource = 'cashbox',
  operationalDayId = '',
  shiftId = '',
  shiftType = '',
  shiftLabel = '',
  createdAt = Date.now(),
  category = SALARY_EXPENSE_CATEGORY
} = {}) => {
  const resolvedEmployeeId = text(employeeId || employee?.id || employee?.employeeId)
  const resolvedEmployeeName = text(employeeName || employee?.name || employee?.employeeName || employee?.employeeNameSnapshot)
  const resolvedEmployeeCode = text(employeeCode || employee?.code || employee?.employeeCode)
  const numericAmount = amount(paidAmount)

  if (!resolvedEmployeeId && !resolvedEmployeeName) {
    throw new Error('يجب تحديد الموظف عند تسجيل دفعة الراتب.')
  }
  if (numericAmount <= 0) {
    throw new Error('مبلغ دفعة الراتب يجب أن يكون أكبر من صفر.')
  }

  const timestamp = Number.isFinite(Number(createdAt)) && Number(createdAt) > 0 ? Number(createdAt) : Date.now()
  const resolvedDate = normalizeDateKey(date || businessDate) || getLocalDateKey(timestamp)
  const resolvedPeriod = normalizePayrollPeriod(payrollPeriod, resolvedDate)
  const resolvedTime = formatTimeSnapshot(time || timestamp)
  const resolvedTxId = text(transactionId || id) || makeTransactionId('sal-pay')
  const resolvedCategory = isSalaryCategory(category) ? text(category) : SALARY_EXPENSE_CATEGORY
  const resolvedNote = text(note)
  const resolvedCreator = text(createdBy || createdByUid || 'الإدارة')

  return normalizeExpense({
    id: resolvedTxId,
    transactionId: resolvedTxId,
    category: resolvedCategory,
    expenseCategory: resolvedCategory,
    type: 'expense',
    amount: numericAmount,
    employeeId: resolvedEmployeeId,
    employeeName: resolvedEmployeeName,
    employeeNameSnapshot: resolvedEmployeeName,
    employeeCode: resolvedEmployeeCode,
    person: resolvedEmployeeName,
    date: resolvedDate,
    businessDate: resolvedDate,
    time: resolvedTime,
    payrollPeriod: resolvedPeriod,
    createdBy: resolvedCreator,
    createdByUid: text(createdByUid),
    note: resolvedNote,
    notes: resolvedNote,
    description: resolvedNote || `دفعة راتب - ${resolvedEmployeeName} (${resolvedPeriod})`,
    fundingSource: text(fundingSource || 'cashbox'),
    operationalDayId: text(operationalDayId),
    shiftId: text(shiftId),
    shiftType: text(shiftType),
    shiftLabel: text(shiftLabel),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'active'
  })
}

export const extractSalaryPaymentDetails = rawRecord => {
  const record = rawRecord || {}
  const date = normalizeDateKey(record.date || record.businessDate) || getLocalDateKey(record.createdAt || record.timestamp)
  const payrollPeriod = normalizePayrollPeriod(record.payrollPeriod || record.payroll_period, date)
  const time = text(record.time) || formatTimeSnapshot(record.createdAt || record.timestamp)
  const transactionId = text(record.transactionId || record.id || record.expenseId)
  const employeeId = text(record.employeeId || record.staffId)
  const employeeName = text(record.employeeNameSnapshot || record.employeeName || record.person || record.name)
  const createdBy = text(record.createdBy || record.createdByName || record.cashierNameSnapshot || record.seller || record.createdByUid)
  const note = text(record.note || record.notes || record.description || record.reason)

  return {
    transactionId,
    id: transactionId,
    employeeId,
    employeeName,
    employeeNameSnapshot: employeeName,
    amount: amount(record.amount),
    date,
    businessDate: date,
    time,
    payrollPeriod,
    createdBy,
    note,
    category: text(record.category || record.expenseCategory || SALARY_EXPENSE_CATEGORY),
    fundingSource: text(record.fundingSource || record.paymentSource || 'cashbox'),
    createdAt: Number(record.createdAt || record.timestamp || 0)
  }
}

const matchesPayrollFilter = (paymentDetails, { payrollPeriod = '', from = '', to = '' } = {}) => {
  const cleanPeriod = text(payrollPeriod)
  if (cleanPeriod && /^\d{4}-\d{2}$/.test(cleanPeriod)) {
    return paymentDetails.payrollPeriod === cleanPeriod
  }
  const cleanFrom = normalizeDateKey(from)
  const cleanTo = normalizeDateKey(to)
  if (cleanFrom && paymentDetails.date < cleanFrom) return false
  if (cleanTo && paymentDetails.date > cleanTo) return false
  return true
}

/**
 * Calculates Salary Due, Salary Paid, and Salary Remaining for a single employee
 * from the canonical money-out ledger (guaranteeing zero double counting).
 */
export const calculateEmployeeSalarySummary = ({
  employee,
  staff = [],
  expenses = [],
  transactions = [],
  payrollPeriod = '',
  from = '',
  to = ''
} = {}) => {
  if (!employee) {
    return {
      employeeId: '',
      employeeName: '',
      fixedMonthlySalary: 0,
      salaryDue: 0,
      salaryPaid: 0,
      salaryRemaining: 0,
      overpaidAmount: 0,
      paymentsCount: 0,
      payments: [],
      cashExpenseImpact: 0
    }
  }

  const fixedMonthlySalary = normalizeFixedMonthlySalary(
    employee.fixedMonthlySalary ?? employee.monthlySalary ?? employee.salaryDue
  )
  const salaryDue = fixedMonthlySalary

  // Use buildMoneyOutLedger so linked cashbox mirror transactions are ignored (no double counting)
  const ledgerRows = buildMoneyOutLedger({ expenses, transactions }).filter(
    row => row.includeInReports && row.reportBucket === 'salary'
  )

  const staffList = Array.isArray(staff) && staff.length > 0 ? staff : [employee]
  const matchedPayments = []

  for (const row of ledgerRows) {
    const sourceRecord = row.original || {}
    const matchedPerson = matchEmployeeRecord(sourceRecord, staffList)
    const isThisEmployee = matchedPerson
      ? String(matchedPerson.id) === String(employee.id)
      : matchesEmployee(sourceRecord, employee)

    if (!isThisEmployee) continue

    const details = extractSalaryPaymentDetails(sourceRecord)
    if (!matchesPayrollFilter(details, { payrollPeriod, from, to })) continue
    matchedPayments.push(details)
  }

  matchedPayments.sort((a, b) => `${b.date}-${b.createdAt}-${b.transactionId}`.localeCompare(`${a.date}-${a.createdAt}-${a.transactionId}`))

  const salaryPaid = matchedPayments.reduce((sum, p) => sum + amount(p.amount), 0)
  const salaryRemaining = Math.max(0, salaryDue - salaryPaid)
  const overpaidAmount = salaryPaid > salaryDue ? salaryPaid - salaryDue : 0

  return {
    employeeId: text(employee.id),
    employeeName: text(employee.name),
    PayrollPeriod: normalizePayrollPeriod(payrollPeriod, from || to),
    payrollPeriod: normalizePayrollPeriod(payrollPeriod, from || to),
    fixedMonthlySalary,
    salaryDue,
    salaryPaid,
    salaryRemaining,
    overpaidAmount,
    paymentsCount: matchedPayments.length,
    payments: matchedPayments,
    // Crucial Rule (Section 14): Only the actually paid salary enters cash/expenses, never the unpaid salary!
    cashExpenseImpact: salaryPaid,
    unpaidExpenseImpact: 0
  }
}

/**
 * Builds a complete payroll report across all employees without cross-employee mixing
 * or double counting.
 */
export const buildPayrollReport = ({
  staff = [],
  expenses = [],
  transactions = [],
  payrollPeriod = '',
  from = '',
  to = ''
} = {}) => {
  const people = (Array.isArray(staff) ? staff : []).filter(p => p && p.id && p.name)
  const employeeSummaries = people.map(person =>
    calculateEmployeeSalarySummary({
      employee: person,
      staff: people,
      expenses,
      transactions,
      payrollPeriod,
      from,
      to
    })
  )

  const totals = employeeSummaries.reduce(
    (acc, row) => ({
      totalFixedMonthlySalary: acc.totalFixedMonthlySalary + row.fixedMonthlySalary,
      totalSalaryDue: acc.totalSalaryDue + row.salaryDue,
      totalSalaryPaid: acc.totalSalaryPaid + row.salaryPaid,
      totalSalaryRemaining: acc.totalSalaryRemaining + row.salaryRemaining,
      salaryDue: acc.salaryDue + row.salaryDue,
      salaryPaid: acc.salaryPaid + row.salaryPaid,
      salaryRemaining: acc.salaryRemaining + row.salaryRemaining,
      totalPaymentsCount: acc.totalPaymentsCount + row.paymentsCount,
      // Only paid salary enters expenses:
      expensesRecordedInSalariesCategory: acc.expensesRecordedInSalariesCategory + row.salaryPaid
    }),
    {
      totalFixedMonthlySalary: 0,
      totalSalaryDue: 0,
      totalSalaryPaid: 0,
      totalSalaryRemaining: 0,
      salaryDue: 0,
      salaryPaid: 0,
      salaryRemaining: 0,
      totalPaymentsCount: 0,
      expensesRecordedInSalariesCategory: 0
    }
  )

  return {
    payrollPeriod: normalizePayrollPeriod(payrollPeriod, from || to),
    from: normalizeDateKey(from),
    to: normalizeDateKey(to),
    employees: employeeSummaries,
    totals
  }
}
