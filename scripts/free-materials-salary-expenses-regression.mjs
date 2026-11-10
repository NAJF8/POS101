import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  FREE_MATERIAL_STORAGE_KEY,
  INVENTORY_MOVEMENTS_STORAGE_KEY,
  INVENTORY_ITEMS_STORAGE_KEY,
  FREE_MATERIAL_TYPES,
  ALLOWED_INVENTORY_MOVEMENT_TYPES,
  FORBIDDEN_MOVEMENT_TYPES,
  isFreeMaterialType,
  resolveReliableItemCost,
  createFreeMaterialRecord,
  recordFreeMaterial,
  buildFreeMaterialsReport,
  mergeFreeMaterialsCollections,
} from '../src/services/freeMaterialService.js'
import {
  EXPENSE_CATEGORIES,
  NEW_EXPENSE_CATEGORIES,
  LEGACY_EXPENSE_CATEGORIES,
  isSalaryCategory,
  normalizeFixedMonthlySalary,
  normalizePayrollPeriod,
  createSalaryPaymentRecord,
  calculateEmployeeSalarySummary,
  buildPayrollReport,
} from '../src/services/salaryService.js'
import { buildEmployeeReport } from '../src/services/employeeReport.js'
import { buildMoneyOutLedger, classifyMoneyOutRecord } from '../src/services/moneyOutClassifier.js'
import { summarizeCashOutflowReport, normalizeCashOutflowReport } from '../src/services/cashOutflowReport.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'
import { buildDeliveryDiscountReport } from '../src/services/deliveryDiscountReport.js'
import { buildShiftReport, buildEndDayShiftReport } from '../src/services/shiftReports.js'
import { getReportSalesForPeriod, normalizeSale } from '../src/services/reportSales.js'
import { isRegularExpense, sumExpenses } from '../src/services/expenseReporting.js'

// ============================================================================
// 1. FREE MATERIALS: GIFT / HOSPITALITY / LOYALTY + COST + INVENTORY + ZERO FINANCIAL IMPACT
// ============================================================================

assert.deepEqual(Object.keys(FREE_MATERIAL_TYPES), ['gift', 'hospitality', 'loyalty'])
assert.deepEqual([...ALLOWED_INVENTORY_MOVEMENT_TYPES], ['GIFT', 'HOSPITALITY', 'LOYALTY'])
assert.equal(ALLOWED_INVENTORY_MOVEMENT_TYPES.includes('SALE'), false)
assert.equal(ALLOWED_INVENTORY_MOVEMENT_TYPES.includes('DISCOUNT'), false)
assert.equal(FORBIDDEN_MOVEMENT_TYPES.has('SALE'), true)
assert.equal(FORBIDDEN_MOVEMENT_TYPES.has('DISCOUNT'), true)
assert.equal(isFreeMaterialType('gift'), true)
assert.equal(isFreeMaterialType('hospitality'), true)
assert.equal(isFreeMaterialType('loyalty'), true)
assert.equal(isFreeMaterialType('discount'), false)
assert.equal(isFreeMaterialType('sale'), false)

// Cost Rule (Section 9):
// Product with Selling Price = 5,000 and actual Cost = 1,500 -> must use 1,500 (never 5,000).
// Product without known reliable cost -> must NOT guess it (unitCost = null, totalCost = null, costKnown = false).
const productsCatalog = [
  { id: 'prod-coffee', name: 'قهوة', price: 5000, cost: 1500, category: 'c1' },
  { id: 'prod-milk', name: 'حليب', price: 4000, cost: 1200, category: 'c1' },
  { id: 'prod-sweets', name: 'حلويات', price: 6000, category: 'c2' }, // No cost known!
]

const knownCostCheck = resolveReliableItemCost({ id: 'prod-coffee', price: 5000 }, productsCatalog[0], null)
assert.equal(knownCostCheck, 1500)
assert.notEqual(knownCostCheck, 5000, 'Must NEVER use Selling Price as Cost')

const unknownCostCheck = resolveReliableItemCost({ id: 'prod-sweets', price: 6000 }, productsCatalog[2], null)
assert.equal(unknownCostCheck, null, 'Must NOT guess cost when unknown')

// Mock localStorage in memory for inventory & local persistence testing
const memoryStorageMap = new Map()
const memoryStorage = {
  getItem: key => (memoryStorageMap.has(key) ? memoryStorageMap.get(key) : null),
  setItem: (key, value) => memoryStorageMap.set(key, String(value)),
}

// Seed initial inventory linked to products
memoryStorage.setItem(INVENTORY_ITEMS_STORAGE_KEY, JSON.stringify([
  { id: 'inv-coffee', productId: 'prod-coffee', name: 'قهوة', quantity: 50, cost: 1500 },
  { id: 'inv-milk', productId: 'prod-milk', name: 'حليب', quantity: 30, cost: 1200 },
  { id: 'inv-sweets', productId: 'prod-sweets', name: 'حلويات', quantity: 20 },
]))

// 1A. Test GIFT (هدية): Selling Price = 5,000, Cost = 1,500, Quantity = 1 -> Cost = 1,500
const giftResult = recordFreeMaterial({
  type: 'gift',
  items: [{ productId: 'prod-coffee', name: 'قهوة', quantity: 1, price: 5000 }],
  products: productsCatalog,
  businessDate: '2026-10-15',
  operationalDayId: 'day-2026-10-15',
  shiftType: 'morning',
  createdBy: 'أحمد الكاشير',
  cashierId: 'emp-1',
  note: 'هدية زبون',
  storage: memoryStorage,
})

assert.equal(giftResult.record.type, 'gift')
assert.equal(giftResult.record.movementType, 'GIFT')
assert.equal(giftResult.record.isSale, false)
assert.equal(giftResult.record.isDiscount, false)
assert.equal(giftResult.record.isPayment, false)
assert.equal(giftResult.record.isRevenue, false)
assert.equal(giftResult.record.isCashExpense, false)
assert.equal(giftResult.record.customerPaid, 0)
assert.equal(giftResult.record.salesImpact, 0)
assert.equal(giftResult.record.discountImpact, 0)
assert.equal(giftResult.record.revenueImpact, 0)
assert.equal(giftResult.record.expenseImpact, 0)
assert.equal(giftResult.record.totalQuantity, 1)
assert.equal(giftResult.record.items[0].unitCost, 1500)
assert.equal(giftResult.record.items[0].totalCost, 1500)
assert.equal(giftResult.record.totalKnownCost, 1500)
assert.equal(giftResult.inventoryMovements.length, 1)
assert.equal(giftResult.inventoryMovements[0].movementType, 'GIFT')
assert.equal(giftResult.inventoryMovements[0].quantity, 1)
assert.equal(giftResult.inventoryMovements[0].direction, 'OUT')

// 1B. Test HOSPITALITY (ضيافة):
// الشخص: شركة X | قهوة × 3 | حليب × 2 | حلويات × 1 (حلويات بدون تكلفة معروفة)
const hospitalityResult = recordFreeMaterial({
  type: 'hospitality',
  recipientName: 'شركة X',
  items: [
    { productId: 'prod-coffee', name: 'قهوة', quantity: 3, price: 5000 },
    { productId: 'prod-milk', name: 'حليب', quantity: 2, price: 4000 },
    { productId: 'prod-sweets', name: 'حلويات', quantity: 1, price: 6000 },
  ],
  products: productsCatalog,
  businessDate: '2026-10-15',
  operationalDayId: 'day-2026-10-15',
  shiftType: 'morning',
  createdBy: 'أحمد الكاشير',
  cashierId: 'emp-1',
  note: 'ضيافة وفد شركة X',
  storage: memoryStorage,
})

assert.equal(hospitalityResult.record.type, 'hospitality')
assert.equal(hospitalityResult.record.movementType, 'HOSPITALITY')
assert.equal(hospitalityResult.record.recipientName, 'شركة X')
assert.equal(hospitalityResult.record.totalQuantity, 6) // 3 + 2 + 1
assert.equal(hospitalityResult.record.customerPaid, 0)
assert.equal(hospitalityResult.record.salesImpact, 0)
assert.equal(hospitalityResult.record.discountImpact, 0)
assert.equal(hospitalityResult.record.revenueImpact, 0)
assert.equal(hospitalityResult.record.expenseImpact, 0)
// Known cost: coffee (3 * 1500 = 4500) + milk (2 * 1200 = 2400) = 6900; sweets cost is null (not guessed!)
assert.equal(hospitalityResult.record.items[0].totalCost, 4500)
assert.equal(hospitalityResult.record.items[1].totalCost, 2400)
assert.equal(hospitalityResult.record.items[2].costKnown, false)
assert.equal(hospitalityResult.record.items[2].unitCost, null)
assert.equal(hospitalityResult.record.items[2].totalCost, null)
assert.equal(hospitalityResult.record.totalKnownCost, 6900)
assert.equal(hospitalityResult.inventoryMovements.every(m => m.movementType === 'HOSPITALITY'), true)

// 1C. Test LOYALTY (ولاء):
const loyaltyResult = recordFreeMaterial({
  type: 'loyalty',
  items: [
    { productId: 'prod-coffee', name: 'قهوة', quantity: 2, price: 5000 },
    { productId: 'prod-sweets', name: 'حلويات', quantity: 1, price: 6000 },
  ],
  products: productsCatalog,
  businessDate: '2026-10-15',
  operationalDayId: 'day-2026-10-15',
  shiftType: 'evening',
  createdBy: 'سارة الكاشير',
  cashierId: 'emp-2',
  note: 'مكافأة ولاء',
  storage: memoryStorage,
})

assert.equal(loyaltyResult.record.type, 'loyalty')
assert.equal(loyaltyResult.record.movementType, 'LOYALTY')
assert.equal(loyaltyResult.record.totalQuantity, 3)
assert.equal(loyaltyResult.record.totalKnownCost, 3000) // 2 * 1500
assert.equal(loyaltyResult.record.customerPaid, 0)
assert.equal(loyaltyResult.record.salesImpact, 0)
assert.equal(loyaltyResult.record.discountImpact, 0)
assert.equal(loyaltyResult.record.revenueImpact, 0)
assert.equal(loyaltyResult.record.expenseImpact, 0)
assert.equal(loyaltyResult.inventoryMovements.every(m => m.movementType === 'LOYALTY'), true)

// Verify Inventory Deduction & Movements (Section 8):
// Initial: coffee=50, milk=30, sweets=20
// Outflows: coffee = 1 (GIFT) + 3 (HOSPITALITY) + 2 (LOYALTY) = 6 -> remaining 44
//           milk   = 2 (HOSPITALITY) -> remaining 28
//           sweets = 1 (HOSPITALITY) + 1 (LOYALTY) = 2 -> remaining 18
const updatedInventory = JSON.parse(memoryStorage.getItem(INVENTORY_ITEMS_STORAGE_KEY))
const invCoffee = updatedInventory.find(row => row.productId === 'prod-coffee')
const invMilk = updatedInventory.find(row => row.productId === 'prod-milk')
const invSweets = updatedInventory.find(row => row.productId === 'prod-sweets')
assert.equal(invCoffee.quantity, 44)
assert.equal(invMilk.quantity, 28)
assert.equal(invSweets.quantity, 18)

const allMovements = JSON.parse(memoryStorage.getItem(INVENTORY_MOVEMENTS_STORAGE_KEY))
assert.equal(allMovements.length, 6)
assert.equal(allMovements.every(m => ['GIFT', 'HOSPITALITY', 'LOYALTY'].includes(m.movementType)), true)
assert.equal(allMovements.some(m => m.movementType === 'SALE' || m.movementType === 'DISCOUNT'), false)

// Verify Free Materials Report (Section 10):
const freeReport = buildFreeMaterialsReport({
  localRecords: JSON.parse(memoryStorage.getItem(FREE_MATERIAL_STORAGE_KEY)),
  from: '2026-10-01',
  to: '2026-10-31',
})
assert.equal(freeReport.gift.operationsCount, 1)
assert.equal(freeReport.gift.totalQuantity, 1)
assert.equal(freeReport.gift.knownTotalCost, 1500)
assert.equal(freeReport.hospitality.operationsCount, 1)
assert.equal(freeReport.hospitality.totalQuantity, 6)
assert.equal(freeReport.hospitality.knownTotalCost, 6900)
assert.equal(freeReport.hospitality.byRecipient[0].recipientName, 'شركة X')
assert.equal(freeReport.loyalty.operationsCount, 1)
assert.equal(freeReport.loyalty.totalQuantity, 3)
assert.equal(freeReport.loyalty.knownTotalCost, 3000)
assert.equal(freeReport.totals.operationsCount, 3)
assert.equal(freeReport.totals.totalQuantity, 10)
assert.equal(freeReport.totals.knownTotalCost, 11400)
assert.equal(freeReport.totals.salesImpact, 0)
assert.equal(freeReport.totals.discountImpact, 0)
assert.equal(freeReport.totals.revenueImpact, 0)
assert.equal(freeReport.totals.expenseImpact, 0)

// ============================================================================
// 2. SALARIES & EMPLOYEES (Sections 11, 12, 13, 14, 16)
// ============================================================================

const employees = [
  { id: 'emp-ali', code: '101-E01', name: 'علي', role: 'cashier', active: true, fixedMonthlySalary: 600000 },
  { id: 'emp-sara', code: '101-E02', name: 'سارة', role: 'cashier', active: true, fixedMonthlySalary: 500000 },
]

// Section 11 & 12 & 13 & 14:
// Example from prompt:
// علي: fixedMonthlySalary = 600,000 د.ع
// Salary Due = 600,000 | Salary Paid = 200,000 | Salary Remaining = 400,000
const aliPayment1 = createSalaryPaymentRecord({
  id: 'sal-tx-001',
  employee: employees[0],
  amount: 200000,
  businessDate: '2026-10-10',
  time: '14:30',
  payrollPeriod: '2026-10',
  createdBy: 'الإدارة',
  note: 'الدفعة الأولى من راتب أكتوبر',
  fundingSource: 'cashbox',
  operationalDayId: 'day-2026-10-10',
  shiftType: 'morning',
})

// Verify all required fields in Section 13:
assert.equal(aliPayment1.employeeId, 'emp-ali')
assert.equal(aliPayment1.employeeNameSnapshot, 'علي')
assert.equal(aliPayment1.amount, 200000)
assert.equal(aliPayment1.date, '2026-10-10')
assert.equal(aliPayment1.businessDate, '2026-10-10')
assert.equal(aliPayment1.time, '14:30')
assert.equal(aliPayment1.payrollPeriod, '2026-10')
assert.equal(aliPayment1.createdBy, 'الإدارة')
assert.equal(aliPayment1.note, 'الدفعة الأولى من راتب أكتوبر')
assert.equal(aliPayment1.transactionId, 'sal-tx-001')
assert.equal(aliPayment1.category, 'رواتب')

// Mirror cashbox transaction linked to aliPayment1 to test NO DOUBLE COUNTING (Section 16)
const aliPayment1MirrorTx = {
  id: 'cb-mirror-sal-tx-001',
  type: 'expense',
  linkedExpenseId: 'sal-tx-001',
  employeeId: 'emp-ali',
  employeeNameSnapshot: 'علي',
  amount: 200000,
  businessDate: '2026-10-10',
  category: 'رواتب',
}

const aliSummarySinglePayment = calculateEmployeeSalarySummary({
  employee: employees[0],
  staff: employees,
  expenses: [aliPayment1],
  transactions: [aliPayment1MirrorTx],
  payrollPeriod: '2026-10',
})

assert.equal(aliSummarySinglePayment.fixedMonthlySalary, 600000)
assert.equal(aliSummarySinglePayment.salaryDue, 600000)
assert.equal(aliSummarySinglePayment.salaryPaid, 200000)
assert.equal(aliSummarySinglePayment.salaryRemaining, 400000)
assert.equal(aliSummarySinglePayment.paymentsCount, 1)

// Multiple payments for Ali + separate payment for Sara (Section 19: أكثر من دفعة، أكثر من موظف، عدم تداخل الموظفين)
const aliPayment2 = createSalaryPaymentRecord({
  id: 'sal-tx-002',
  employee: employees[0],
  amount: 150000,
  businessDate: '2026-10-20',
  time: '18:15',
  payrollPeriod: '2026-10',
  createdBy: 'الإدارة',
  note: 'الدفعة الثانية من راتب أكتوبر',
  fundingSource: 'cashbox',
  operationalDayId: 'day-2026-10-20',
  shiftType: 'evening',
})

const saraPayment1 = createSalaryPaymentRecord({
  id: 'sal-tx-003',
  employee: employees[1],
  amount: 300000,
  businessDate: '2026-10-22',
  time: '16:00',
  payrollPeriod: '2026-10',
  createdBy: 'الإدارة',
  note: 'دفعة راتب سارة',
  fundingSource: 'cashbox',
  operationalDayId: 'day-2026-10-22',
  shiftType: 'evening',
})

const payrollReport = buildPayrollReport({
  staff: employees,
  expenses: [aliPayment1, aliPayment2, saraPayment1],
  transactions: [aliPayment1MirrorTx],
  payrollPeriod: '2026-10',
})

const aliPayroll = payrollReport.employees.find(row => row.employeeId === 'emp-ali')
const saraPayroll = payrollReport.employees.find(row => row.employeeId === 'emp-sara')

assert.equal(aliPayroll.salaryDue, 600000)
assert.equal(aliPayroll.salaryPaid, 350000) // 200,000 + 150,000
assert.equal(aliPayroll.salaryRemaining, 250000)
assert.equal(aliPayroll.paymentsCount, 2)

assert.equal(saraPayroll.salaryDue, 500000)
assert.equal(saraPayroll.salaryPaid, 300000)
assert.equal(saraPayroll.salaryRemaining, 200000)
assert.equal(saraPayroll.paymentsCount, 1)

assert.equal(payrollReport.totals.salaryDue, 1100000)
assert.equal(payrollReport.totals.salaryPaid, 650000)
assert.equal(payrollReport.totals.salaryRemaining, 450000)

// Verify buildEmployeeReport integration:
const empReport = buildEmployeeReport({
  staff: employees,
  sales: [],
  expenses: [aliPayment1],
  transactions: [aliPayment1MirrorTx],
  from: '2026-10-01',
  to: '2026-10-31',
})
const empAliRow = empReport.summaries.find(row => row.employee.id === 'emp-ali')
assert.equal(empAliRow.fixedMonthlySalary, 600000)
assert.equal(empAliRow.salaryDue, 600000)
assert.equal(empAliRow.salaryPaid, 200000)
assert.equal(empAliRow.salaryTotal, 200000)
assert.equal(empAliRow.salaryRemaining, 400000)
assert.equal(empAliRow.expensesTotal, 0, 'Salary must NOT appear in general employee expensesTotal (no double counting)')

// ============================================================================
// 3. EXPENSES & NEW CATEGORIES + NO DOUBLE COUNTING (Sections 14, 15, 16, 19)
// ============================================================================

assert.deepEqual(NEW_EXPENSE_CATEGORIES, ['العصائر', 'الحلويات', 'القهوة', 'الحليب', 'رواتب'])
for (const legacyCategory of ['مشتريات', 'صيانة', 'نقل', 'أدوات تنظيف', 'راتب', 'سحوبات', 'أخرى']) {
  assert.equal(LEGACY_EXPENSE_CATEGORIES.includes(legacyCategory), true, `Legacy category ${legacyCategory} must be preserved`)
  assert.equal(EXPENSE_CATEGORIES.includes(legacyCategory), true, `Category ${legacyCategory} must be in EXPENSE_CATEGORIES`)
}
for (const newCategory of ['العصائر', 'الحلويات', 'القهوة', 'الحليب', 'رواتب']) {
  assert.equal(EXPENSE_CATEGORIES.includes(newCategory), true, `New category ${newCategory} must be in EXPENSE_CATEGORIES`)
}

assert.equal(isSalaryCategory('رواتب'), true)
assert.equal(isSalaryCategory('راتب'), true)
assert.equal(isSalaryCategory('القهوة'), false)

const categoryExpenses = [
  { id: 'exp-juice', category: 'العصائر', amount: 25000, businessDate: '2026-10-15', fundingSource: 'cashbox', description: 'عصائر طبيعية' },
  { id: 'exp-sweets', category: 'الحلويات', amount: 30000, businessDate: '2026-10-15', fundingSource: 'cashbox', description: 'كيك وحلويات' },
  { id: 'exp-coffee', category: 'القهوة', amount: 45000, businessDate: '2026-10-15', fundingSource: 'cashbox', description: 'بن مختص' },
  { id: 'exp-milk', category: 'الحليب', amount: 20000, businessDate: '2026-10-15', fundingSource: 'cashbox', description: 'حليب طازج' },
  { id: 'exp-maint', category: 'صيانة', amount: 15000, businessDate: '2026-10-15', fundingSource: 'cashbox', description: 'صيانة مطحنة' },
  aliPayment1, // 200,000 IQD salary paid (out of 600,000 due)
]

// Verify classification & no double counting:
// - The 4 new material expense categories + legacy 'صيانة' classify as 'business_expense' (135,000 IQD)
// - 'رواتب' classifies as 'salary' (200,000 IQD)
// - Mirror cashbox transaction is 'ignored'
// - Total cash expense paid = 135,000 + 200,000 = 335,000 IQD (NOT 335,000 + 400,000 unpaid salary, and NOT counting aliPayment1 twice!)
const moneyOutLedger = buildMoneyOutLedger({
  expenses: categoryExpenses,
  transactions: [aliPayment1MirrorTx],
  staff: employees,
})

const businessExpensesRows = moneyOutLedger.filter(r => r.includeInReports && r.reportBucket === 'business_expense')
const salariesRows = moneyOutLedger.filter(r => r.includeInReports && r.reportBucket === 'salary')
const ignoredRows = moneyOutLedger.filter(r => !r.includeInReports || r.reportBucket === 'ignored')

assert.equal(businessExpensesRows.length, 5)
assert.equal(salariesRows.length, 1)
assert.equal(ignoredRows.length, 1)

const businessExpenseSum = businessExpensesRows.reduce((sum, r) => sum + r.amount, 0)
const salaryPaidSum = salariesRows.reduce((sum, r) => sum + r.amount, 0)
assert.equal(businessExpenseSum, 135000) // 25k + 30k + 45k + 20k + 15k
assert.equal(salaryPaidSum, 200000)      // Only paid salary, never unpaid 400k!

// Verify cashOutflowReport & comprehensiveReport expenses total:
const outflowRows = normalizeCashOutflowReport({
  expenses: categoryExpenses,
  transactions: [aliPayment1MirrorTx],
  staff: employees,
})
const outflowSummary = summarizeCashOutflowReport(outflowRows)
assert.equal(outflowSummary.normalBusinessExpensesTotal, 335000) // 135,000 shop expenses + 200,000 paid salary, counted ONCE
assert.equal(sumExpenses(categoryExpenses.filter(isRegularExpense)), 335000)

// Verify 'safe' ("من القاصة") fundingSource: appears in reports and does NOT deduct from POS cashbox
const safeExpense = { id: 'exp-safe-1', category: 'القهوة', amount: 50000, businessDate: '2026-10-15', fundingSource: 'safe', description: 'شراء بن من القاصة' }
const outflowWithSafe = normalizeCashOutflowReport({
  expenses: [...categoryExpenses, safeExpense],
  transactions: [aliPayment1MirrorTx],
  staff: employees,
})
const safeOutflowRow = outflowWithSafe.find(r => r.id === 'exp-safe-1')
assert.ok(safeOutflowRow, 'Safe expense must appear in outflow report')
assert.equal(safeOutflowRow.fundingSource, 'safe')
assert.equal(safeOutflowRow.sourceLabel, 'من القاصة')

// ============================================================================
// 4. FINANCIAL IMMUNITY CHECK: FREE MATERIALS DO NOT ALTER ANY SALE / DISCOUNT / REPORT NUMBER
// ============================================================================

const sampleSales = [
  normalizeSale({
    id: 'sale-im-1',
    orderNumber: 1,
    items: [{ id: 'prod-coffee', name: 'قهوة', price: 5000, quantity: 2 }],
    subtotal: 10000,
    discount: 0,
    total: 10000,
    paymentMethod: 'cash',
    businessDate: '2026-10-15',
    operationalDayId: 'day-2026-10-15',
    shift: 'كاشير صباحي',
    shiftType: 'morning',
  }),
  normalizeSale({
    id: 'sale-im-2',
    orderNumber: 2,
    items: [{ id: 'prod-coffee', name: 'قهوة', price: 5000, quantity: 4 }],
    subtotal: 20000,
    discount: 5200,
    total: 14800,
    discountDetails: { type: 'social_26_baly', source: 'baly', label: 'خصم بلي 26%', amount: 5200 },
    paymentMethod: 'cash',
    businessDate: '2026-10-15',
    operationalDayId: 'day-2026-10-15',
    shift: 'كاشير مسائي',
    shiftType: 'evening',
  }),
]

const compSummary = calculateComprehensiveSummary(sampleSales, categoryExpenses, [aliPayment1MirrorTx], null)
// Sales: grossSales = 30,000; discounts = 5,200; netAfterDiscount = 24,800; cashSales = 24,800
assert.equal(compSummary.grossSales, 30000)
assert.equal(compSummary.discounts, 5200)
assert.equal(compSummary.netAfterDiscount, 24800)

const compSummaryWithSafe = calculateComprehensiveSummary(sampleSales, [...categoryExpenses, safeExpense], [aliPayment1MirrorTx], null)
assert.equal(compSummaryWithSafe.expenses, compSummary.expenses + 50000)
assert.equal(compSummaryWithSafe.cashboxExpenses, compSummary.cashboxExpenses)
assert.equal(compSummaryWithSafe.netCashAfterAll, compSummary.netCashAfterAll)
assert.equal(compSummary.cashSales, 24800)
// Expenses in comprehensive summary: 135,000 + 200,000 (paid salary) = 335,000. Free material cost (11,400) is NOT in expenses!
assert.equal(compSummary.expenses, 335000)
assert.equal(compSummary.cashboxExpenses, 335000)

// ============================================================================
// 5. PRODUCTION SAFETY AUDIT EXPLICIT SCENARIOS (Sections 4–15)
// ============================================================================

// Section 4: Mixed Sales (No discount + Normal discount + Baly + Toters)
const mixedSales = [
  normalizeSale({
    id: 'mix-no-disc', orderNumber: 101,
    items: [{ id: 'p1', name: 'قهوة', price: 5000, quantity: 2 }],
    subtotal: 10000, discount: 0, total: 10000,
    paymentMethod: 'cash', businessDate: '2026-10-16', operationalDayId: 'day-2026-10-16', shift: 'كاشير صباحي', shiftType: 'morning',
  }),
  normalizeSale({
    id: 'mix-normal-disc', orderNumber: 102,
    items: [{ id: 'p1', name: 'قهوة', price: 5000, quantity: 2 }],
    subtotal: 10000, discount: 2000, total: 8000,
    discountDetails: { type: 'manual', source: 'store', label: 'خصم عادي', amount: 2000 },
    paymentMethod: 'cash', businessDate: '2026-10-16', operationalDayId: 'day-2026-10-16', shift: 'كاشير صباحي', shiftType: 'morning',
  }),
  normalizeSale({
    id: 'mix-baly', orderNumber: 103,
    items: [{ id: 'p1', name: 'قهوة', price: 5000, quantity: 4 }],
    subtotal: 20000, discount: 5200, total: 14800,
    discountDetails: { kind: 'baly', type: 'social_26_baly', source: 'baly', label: 'خصم بلي 26%', amount: 5200 },
    paymentMethod: 'cash', businessDate: '2026-10-16', operationalDayId: 'day-2026-10-16', shift: 'كاشير مسائي', shiftType: 'evening',
  }),
  normalizeSale({
    id: 'mix-toters', orderNumber: 104,
    items: [{ id: 'p2', name: 'عصير', price: 4000, quantity: 3 }],
    subtotal: 12000, discount: 3000, total: 9000,
    discountDetails: { kind: 'toters', type: 'toters', source: 'toters', label: 'خصم توترز', amount: 3000 },
    paymentMethod: 'electronic', businessDate: '2026-10-16', operationalDayId: 'day-2026-10-16', shift: 'كاشير مسائي', shiftType: 'evening',
  }),
]

const mixedDelivReport = buildDeliveryDiscountReport(mixedSales, { from: '2026-10-16', to: '2026-10-16', source: 'all' })
assert.deepEqual(mixedDelivReport.totals.baly, { count: 1, originalTotal: 20000, discount: 5200, finalTotal: 14800 })
assert.deepEqual(mixedDelivReport.totals.toters, { count: 1, originalTotal: 12000, discount: 3000, finalTotal: 9000 })
const mixedComp = calculateComprehensiveSummary(mixedSales, [], [], null)
assert.equal(mixedComp.grossSales, 52000)      // 10k + 10k + 20k + 12k
assert.equal(mixedComp.discounts, 10200)       // 0 + 2k + 5.2k + 3k (no double counting, no missing discount)
assert.equal(mixedComp.netAfterDiscount, 41800)
assert.equal(mixedComp.expenses, 0)            // Discounts NEVER converted into expenses

// Section 5 & 7: Cost Safety (Selling Price = 5000, Cost = 1500, Quantity = 2 -> Total Cost = 3000, never 10000) + cashImpact = 0
const costSafetyRec = createFreeMaterialRecord({
  type: 'gift',
  items: [{ productId: 'prod-coffee', name: 'قهوة', quantity: 2, price: 5000 }],
  products: productsCatalog,
  businessDate: '2026-10-16',
})
assert.equal(costSafetyRec.items[0].unitCost, 1500)
assert.equal(costSafetyRec.items[0].totalCost, 3000)
assert.notEqual(costSafetyRec.items[0].totalCost, 10000)
assert.equal(costSafetyRec.customerPaid, 0)
assert.equal(costSafetyRec.salesImpact, 0)
assert.equal(costSafetyRec.discountImpact, 0)
assert.equal(costSafetyRec.revenueImpact, 0)
assert.equal(costSafetyRec.cashImpact, 0)
assert.equal(costSafetyRec.expenseImpact, 0)

// Section 6: Single deduction check (Coffee × 3 -> deducts 3 only, not 6 or 9)
const singleDeductStorageMap = new Map()
const singleDeductStorage = {
  getItem: k => (singleDeductStorageMap.has(k) ? singleDeductStorageMap.get(k) : null),
  setItem: (k, v) => singleDeductStorageMap.set(k, String(v)),
}
singleDeductStorage.setItem(INVENTORY_ITEMS_STORAGE_KEY, JSON.stringify([
  { id: 'inv-c', productId: 'prod-coffee', name: 'قهوة', quantity: 10, cost: 1500 },
]))
const coffee3Res = recordFreeMaterial({
  type: 'hospitality',
  recipientName: 'شركة X',
  items: [{ productId: 'prod-coffee', name: 'قهوة', quantity: 3, price: 5000 }],
  products: productsCatalog,
  businessDate: '2026-10-16',
  storage: singleDeductStorage,
})
assert.equal(coffee3Res.inventoryMovements.length, 1)
assert.equal(coffee3Res.inventoryMovements[0].quantity, 3)
assert.equal(coffee3Res.inventoryStock[0].quantity, 7) // 10 - 3 = 7 (deducted once only!)

// Section 9, 10, 11: Salary Due = 600,000, Paid = 200,000 -> Remaining = 400,000; + 100,000 -> Paid = 300,000, Remaining = 300,000; + Employee C with 0 payments
const auditStaff = [
  { id: 'emp-a', code: 'A1', name: 'موظف A', fixedMonthlySalary: 600000 },
  { id: 'emp-b', code: 'B1', name: 'موظف B', fixedMonthlySalary: 500000 },
  { id: 'emp-c', code: 'C1', name: 'موظف C', fixedMonthlySalary: 450000 },
]
const payA1 = createSalaryPaymentRecord({ id: 'pa1', employee: auditStaff[0], amount: 200000, businessDate: '2026-10-05', payrollPeriod: '2026-10' })
const payA1Mirror = { id: 'tx-pa1', type: 'expense', linkedExpenseId: 'pa1', employeeId: 'emp-a', amount: 200000, businessDate: '2026-10-05', category: 'رواتب' }
const sumA_step1 = calculateEmployeeSalarySummary({ employee: auditStaff[0], staff: auditStaff, expenses: [payA1], transactions: [payA1Mirror], payrollPeriod: '2026-10' })
assert.equal(sumA_step1.salaryDue, 600000)
assert.equal(sumA_step1.salaryPaid, 200000)
assert.equal(sumA_step1.salaryRemaining, 400000)
assert.equal(sumA_step1.cashExpenseImpact, 200000) // Cash expense is 200,000 ONLY, never 600,000 and never 400,000!

const payA2 = createSalaryPaymentRecord({ id: 'pa2', employee: auditStaff[0], amount: 100000, businessDate: '2026-10-15', payrollPeriod: '2026-10' })
const payB1 = createSalaryPaymentRecord({ id: 'pb1', employee: auditStaff[1], amount: 250000, businessDate: '2026-10-15', payrollPeriod: '2026-10' })
const fullPayroll = buildPayrollReport({ staff: auditStaff, expenses: [payA1, payA2, payB1], transactions: [payA1Mirror], payrollPeriod: '2026-10' })
const rowA = fullPayroll.employees.find(e => e.employeeId === 'emp-a')
const rowB = fullPayroll.employees.find(e => e.employeeId === 'emp-b')
const rowC = fullPayroll.employees.find(e => e.employeeId === 'emp-c')
assert.equal(rowA.salaryPaid, 300000)
assert.equal(rowA.salaryRemaining, 300000)
assert.equal(rowB.salaryPaid, 250000)
assert.equal(rowB.salaryRemaining, 250000)
assert.equal(rowC.salaryPaid, 0)
assert.equal(rowC.salaryRemaining, 450000)

// Section 13: Critical Accounting Distinction (Purchase Expense = 150,000 vs Free Material Consumption = 10,000 cost)
const purchaseCoffeeExpense = { id: 'pur-coffee-150k', category: 'القهوة', amount: 150000, businessDate: '2026-10-16', fundingSource: 'cashbox', description: 'شراء قهوة' }
const hospitalityConsumption10k = createFreeMaterialRecord({
  type: 'hospitality',
  recipientName: 'ضيوف',
  items: [{ productId: 'prod-coffee', name: 'قهوة', quantity: 5, cost: 2000, price: 5000 }], // 5 * 2000 = 10,000 cost
  businessDate: '2026-10-16',
})
assert.equal(hospitalityConsumption10k.totalKnownCost, 10000)
assert.equal(hospitalityConsumption10k.expenseImpact, 0)
const compWithPurchase = calculateComprehensiveSummary(mixedSales, [purchaseCoffeeExpense], [], null)
assert.equal(compWithPurchase.expenses, 150000, 'Cash expense must be 150,000 only — NEVER 150,000 + 10,000!')

// Section 14: Free Materials Report with (هدية: 15 مادة | ضيافة: 23 مادة | ولاء: 8 مواد)
const sec14Report = buildFreeMaterialsReport({
  records: [
    createFreeMaterialRecord({ type: 'gift', items: [{ name: 'قهوة', quantity: 15, cost: 1500 }], businessDate: '2026-10-16' }),
    createFreeMaterialRecord({ type: 'hospitality', recipientName: 'شركة X', items: [{ name: 'قهوة', quantity: 23, cost: 1500 }], businessDate: '2026-10-16' }),
    createFreeMaterialRecord({ type: 'loyalty', items: [{ name: 'قهوة', quantity: 8, cost: 1500 }], businessDate: '2026-10-16' }),
  ],
  from: '2026-10-16',
  to: '2026-10-16',
})
assert.equal(sec14Report.gift.totalQuantity, 15)
assert.equal(sec14Report.hospitality.totalQuantity, 23)
assert.equal(sec14Report.loyalty.totalQuantity, 8)
assert.equal(sec14Report.summary.totalQuantity, 46)
assert.equal(sec14Report.summary.salesImpact, 0)
assert.equal(sec14Report.summary.discountImpact, 0)
assert.equal(sec14Report.summary.cashImpact, 0)
assert.equal(sec14Report.summary.expenseImpact, 0)

// Verify UI source files contain the new elements without breaking existing patterns
const expensesUiSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
for (const cat of ['العصائر', 'الحلويات', 'القهوة', 'الحليب', 'رواتب']) {
  assert.match(expensesUiSource, new RegExp(cat))
}
const reportsUiSource = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(reportsUiSource, /free-materials-report-card/)
assert.match(reportsUiSource, /free-materials-report-section/)
assert.match(reportsUiSource, /الراتب المستحق/)
assert.match(reportsUiSource, /المتبقي من الراتب/)

console.log(JSON.stringify({
  GIFT_MOVEMENT_AND_COST: 'PASS',
  HOSPITALITY_RECIPIENT_AND_COST: 'PASS',
  LOYALTY_MOVEMENT_AND_COST: 'PASS',
  UNKNOWN_COST_NEVER_GUESSED: 'PASS',
  SELLING_PRICE_NEVER_USED_AS_COST: 'PASS',
  INVENTORY_MOVEMENTS_GIFT_HOSPITALITY_LOYALTY_ONLY: 'PASS',
  FREE_MATERIALS_ZERO_FINANCIAL_IMPACT: 'PASS',
  SALARY_FIXED_DUE_PAID_REMAINING: 'PASS',
  SALARY_MULTIPLE_PAYMENTS_AND_EMPLOYEES: 'PASS',
  SALARY_PAID_ONLY_IN_CASH_EXPENSES: 'PASS',
  NO_DOUBLE_COUNTING_SALARIES_OR_FREE_MATERIALS: 'PASS',
  NEW_AND_LEGACY_EXPENSE_CATEGORIES: 'PASS',
}, null, 2))
