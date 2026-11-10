import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canonicalSalesForOperationalDay,
  reconcileCanonicalSales,
  saleDiscountOf,
  saleGrossOf,
  saleNetOf,
  summarizeCanonicalSales
} from '../src/services/canonicalSales.js'
import {
  actualCashDiscountOf,
  getReportSalesForOperationalDay,
  getReportSalesForPeriod,
  normalizeSale
} from '../src/services/reportSales.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'
import { buildEndDayShiftReport, buildShiftReport } from '../src/services/shiftReports.js'
import { buildDeliveryDiscountReport } from '../src/services/deliveryDiscountReport.js'
import { calculateOperationalDaySummary } from '../src/services/operationalDayReport.js'
import { filterRowsByBusinessDate } from '../src/services/periodReport.js'
import { buildMaterialsReport } from '../src/services/materialsReport.js'
import { calculateFinancialReport, calculateSettlement } from '../src/services/financialCenter.js'
import { normalizeSaleAttempt } from '../src/services/saleEngine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BASELINE_PATH = path.join(__dirname, 'financial-snapshot-baseline.json')

export function buildDeterministicFixtureDataset() {
  // 1. Validate normalizeSaleAttempt for canonical POS attempts
  const attemptNoDiscount = normalizeSaleAttempt({
    activeOrder: {
      id: 'ord-snap-1',
      name: 'صالة 1',
      orderType: 'dine-in',
      items: [
        { id: 'c1', productId: 'p-esp', name: 'إسبريسو', category: 'القهوة', price: 3000, quantity: 2 },
        { id: 'c2', productId: 'p-wat', name: 'ماء', category: 'مشروبات', price: 500, quantity: 2 }
      ],
      discount: null
    },
    payment: { method: 'cash', amountReceived: 10000, change: 3000 },
    sellerName: 'علي',
    session: { shiftId: 'shift-m-1', shiftType: 'morning', shiftLabel: 'صباحي', name: 'علي' },
    operationalDay: { id: 'op-2026-10-01', businessDate: '2026-10-01', status: 'open' },
    subtotal: 7000,
    discount: 0,
    total: 7000
  })

  const attemptNormalDiscount = normalizeSaleAttempt({
    activeOrder: {
      id: 'ord-snap-2',
      name: 'صالة 2',
      orderType: 'dine-in',
      items: [
        { id: 'c3', productId: 'p-lat', name: 'لاتيه', category: 'القهوة', price: 5000, quantity: 2 }
      ],
      discount: { kind: 'amount', input: 2000, value: 2000 }
    },
    payment: { method: 'cash', amountReceived: 8000, change: 0 },
    sellerName: 'علي',
    session: { shiftId: 'shift-m-1', shiftType: 'morning', shiftLabel: 'صباحي', name: 'علي' },
    operationalDay: { id: 'op-2026-10-01', businessDate: '2026-10-01', status: 'open' },
    subtotal: 10000,
    discount: 2000,
    total: 8000
  })

  const attemptBaly = normalizeSaleAttempt({
    activeOrder: {
      id: 'ord-snap-3',
      name: 'توصيل بلي',
      orderType: 'delivery',
      items: [
        { id: 'c4', productId: 'p-cake', name: 'تشيز كيك', category: 'الحلويات', price: 10000, quantity: 2 }
      ],
      discount: { kind: 'baly', input: 26, value: 5200 }
    },
    payment: { method: 'cash', amountReceived: 14800, change: 0 },
    sellerName: 'علي',
    session: { shiftId: 'shift-e-1', shiftType: 'evening', shiftLabel: 'مسائي', name: 'علي' },
    operationalDay: { id: 'op-2026-10-01', businessDate: '2026-10-01', status: 'open' },
    subtotal: 20000,
    discount: 5200,
    total: 14800
  })

  const attemptToters = normalizeSaleAttempt({
    activeOrder: {
      id: 'ord-snap-4',
      name: 'توصيل توترز',
      orderType: 'delivery',
      items: [
        { id: 'c5', productId: 'p-moj', name: 'موهيتو', category: 'العصائر', price: 6000, quantity: 2 }
      ],
      discount: { kind: 'toters', input: 25, value: 3000 }
    },
    payment: { method: 'electronic', amountReceived: 9000, change: 0 },
    sellerName: 'حسن',
    session: { shiftId: 'shift-e-1', shiftType: 'evening', shiftLabel: 'مسائي', name: 'حسن' },
    operationalDay: { id: 'op-2026-10-01', businessDate: '2026-10-01', status: 'open' },
    subtotal: 12000,
    discount: 3000,
    total: 9000
  })

  const saleDay1NoDiscount = {
    id: 'sale-snap-1',
    saleId: 'sale-snap-1',
    operationKey: 'opkey-snap-1',
    orderNumber: 101,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    createdAt: 1760000060000,
    shiftId: 'shift-m-1',
    shiftType: 'morning',
    shiftLabel: 'صباحي',
    paymentMethod: 'cash',
    status: 'completed',
    subtotal: attemptNoDiscount.subtotal,
    discount: attemptNoDiscount.discount,
    discountDetails: attemptNoDiscount.order.discount,
    total: attemptNoDiscount.total,
    cashierId: 'emp-1',
    cashierNameSnapshot: 'علي',
    items: attemptNoDiscount.items
  }

  const saleDay1NormalDiscount = {
    id: 'sale-snap-2',
    saleId: 'sale-snap-2',
    operationKey: 'opkey-snap-2',
    orderNumber: 102,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    createdAt: 1760000120000,
    shiftId: 'shift-m-1',
    shiftType: 'morning',
    shiftLabel: 'صباحي',
    paymentMethod: 'cash',
    status: 'completed',
    subtotal: attemptNormalDiscount.subtotal,
    discount: attemptNormalDiscount.discount,
    discountDetails: attemptNormalDiscount.order.discount,
    total: attemptNormalDiscount.total,
    cashierId: 'emp-1',
    cashierNameSnapshot: 'علي',
    items: attemptNormalDiscount.items
  }

  const saleDay1Baly = {
    id: 'sale-snap-3',
    saleId: 'sale-snap-3',
    operationKey: 'opkey-snap-3',
    orderNumber: 103,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    createdAt: 1760016000000,
    shiftId: 'shift-e-1',
    shiftType: 'evening',
    shiftLabel: 'مسائي',
    paymentMethod: 'cash',
    status: 'completed',
    subtotal: attemptBaly.subtotal,
    discount: attemptBaly.discount,
    discountDetails: attemptBaly.order.discount,
    total: attemptBaly.total,
    cashierId: 'emp-1',
    cashierNameSnapshot: 'علي',
    items: attemptBaly.items
  }

  const saleDay1Toters = {
    id: 'sale-snap-4',
    saleId: 'sale-snap-4',
    operationKey: 'opkey-snap-4',
    orderNumber: 104,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    createdAt: 1760017000000,
    shiftId: 'shift-e-1',
    shiftType: 'evening',
    shiftLabel: 'مسائي',
    paymentMethod: 'electronic',
    status: 'completed',
    subtotal: attemptToters.subtotal,
    discount: attemptToters.discount,
    discountDetails: attemptToters.order.discount,
    total: attemptToters.total,
    cashierId: 'emp-2',
    cashierNameSnapshot: 'حسن',
    items: attemptToters.items
  }

  // Additional multi-day & full-month central sales
  const centralSales = [
    saleDay1NoDiscount,
    saleDay1NormalDiscount,
    saleDay1Baly,
    saleDay1Toters,
    {
      id: 'sale-central-day2-1',
      saleId: 'sale-central-day2-1',
      operationKey: 'opkey-day2-1',
      orderNumber: 201,
      businessDate: '2026-10-02',
      operationalDayId: 'op-2026-10-02',
      createdAt: 1760100000000,
      shiftId: 'shift-m-2',
      shiftType: 'morning',
      shiftLabel: 'صباحي',
      paymentMethod: 'cash',
      status: 'completed',
      subtotal: 15000,
      discount: 1000,
      discountDetails: { kind: 'amount', input: 1000, value: 1000 },
      total: 14000,
      cashierId: 'emp-1',
      cashierNameSnapshot: 'علي',
      items: [
        { id: 'c6', productId: 'p-lat', name: 'لاتيه', category: 'القهوة', price: 5000, quantity: 3 }
      ]
    },
    {
      id: 'sale-central-day2-2',
      saleId: 'sale-central-day2-2',
      operationKey: 'opkey-day2-2',
      orderNumber: 202,
      businessDate: '2026-10-02',
      operationalDayId: 'op-2026-10-02',
      createdAt: 1760110000000,
      shiftId: 'shift-e-2',
      shiftType: 'evening',
      shiftLabel: 'مسائي',
      paymentMethod: 'electronic',
      status: 'completed',
      subtotal: 8000,
      discount: 0,
      discountDetails: null,
      total: 8000,
      cashierId: 'emp-2',
      cashierNameSnapshot: 'حسن',
      items: [
        { id: 'c7', productId: 'p-cake', name: 'تشيز كيك', category: 'الحلويات', price: 8000, quantity: 1 }
      ]
    },
    {
      id: 'sale-central-day15-1',
      saleId: 'sale-central-day15-1',
      operationKey: 'opkey-day15-1',
      orderNumber: 301,
      businessDate: '2026-10-15',
      operationalDayId: 'op-2026-10-15',
      createdAt: 1760500000000,
      shiftId: 'shift-m-15',
      shiftType: 'morning',
      shiftLabel: 'صباحي',
      paymentMethod: 'cash',
      status: 'completed',
      subtotal: 25000,
      discount: 6500,
      discountDetails: { kind: 'baly', input: 26, value: 6500 },
      total: 18500,
      cashierId: 'emp-1',
      cashierNameSnapshot: 'علي',
      items: [
        { id: 'c8', productId: 'p-esp', name: 'إسبريسو', category: 'القهوة', price: 5000, quantity: 5 }
      ]
    },
    {
      id: 'sale-central-day31-1',
      saleId: 'sale-central-day31-1',
      operationKey: 'opkey-day31-1',
      orderNumber: 401,
      businessDate: '2026-10-31',
      operationalDayId: 'op-2026-10-31',
      createdAt: 1761800000000,
      shiftId: 'shift-e-31',
      shiftType: 'evening',
      shiftLabel: 'مسائي',
      paymentMethod: 'cash',
      status: 'completed',
      subtotal: 18000,
      discount: 4500,
      discountDetails: { kind: 'toters', input: 25, value: 4500 },
      total: 13500,
      cashierId: 'emp-2',
      cashierNameSnapshot: 'حسن',
      items: [
        { id: 'c9', productId: 'p-moj', name: 'موهيتو', category: 'العصائر', price: 6000, quantity: 3 }
      ]
    }
  ]

  const localSales = [
    saleDay1NoDiscount,
    saleDay1NormalDiscount,
    saleDay1Baly,
    saleDay1Toters
  ]

  const operationalDays = [
    { id: 'op-2026-10-01', businessDate: '2026-10-01', status: 'open', openingBalance: 50000 },
    { id: 'op-2026-10-02', businessDate: '2026-10-02', status: 'closed', openingBalance: 60000 },
    { id: 'op-2026-10-15', businessDate: '2026-10-15', status: 'closed', openingBalance: 40000 },
    { id: 'op-2026-10-31', businessDate: '2026-10-31', status: 'closed', openingBalance: 45000 }
  ]

  const expenses = [
    {
      id: 'exp-snap-1',
      title: 'شراء حليب وبن',
      category: 'مشتريات',
      amount: 5000,
      businessDate: '2026-10-01',
      operationalDayId: 'op-2026-10-01',
      shiftId: 'shift-m-1',
      shiftType: 'morning',
      fundingSource: 'cashbox',
      AffectsDrawer: true,
      cashboxTransactionId: 'tx-exp-snap-1',
      createdAt: 1760001000000
    },
    {
      id: 'exp-snap-2',
      title: 'صيانة مطحنة',
      category: 'صيانة',
      amount: 3000,
      businessDate: '2026-10-02',
      operationalDayId: 'op-2026-10-02',
      shiftId: 'shift-e-2',
      shiftType: 'evening',
      fundingSource: 'management',
      AffectsDrawer: false,
      createdAt: 1760105000000
    },
    {
      id: 'exp-snap-3',
      title: 'سحب المالك',
      category: 'سحوبات',
      amount: 4000,
      person: 'عمر (مالك)',
      businessDate: '2026-10-01',
      operationalDayId: 'op-2026-10-01',
      shiftId: 'shift-e-1',
      shiftType: 'evening',
      fundingSource: 'cashbox',
      AffectsDrawer: true,
      cashboxTransactionId: 'tx-exp-snap-3',
      createdAt: 1760002000000
    }
  ]

  const transactions = [
    {
      id: 'tx-exp-snap-1',
      type: 'expense',
      expenseId: 'exp-snap-1',
      category: 'مشتريات',
      amount: 5000,
      businessDate: '2026-10-01',
      operationalDayId: 'op-2026-10-01',
      shiftId: 'shift-m-1',
      shiftType: 'morning',
      timestamp: 1760001000000
    },
    {
      id: 'tx-exp-snap-3',
      type: 'withdrawal',
      expenseId: 'exp-snap-3',
      category: 'سحوبات',
      amount: 4000,
      businessDate: '2026-10-01',
      operationalDayId: 'op-2026-10-01',
      shiftId: 'shift-e-1',
      shiftType: 'evening',
      timestamp: 1760002000000
    }
  ]

  return {
    localSales,
    centralSales,
    operationalDays,
    expenses,
    transactions
  }
}

export function computeFinancialSnapshot() {
  const { localSales, centralSales, operationalDays, expenses, transactions } = buildDeterministicFixtureDataset()

  // 1. Canonical Sales & Individual Sale Metrics
  const canonicalDay1 = canonicalSalesForOperationalDay({
    localSales,
    centralSales,
    operationalDay: operationalDays[0]
  })
  const reconciledDay1 = reconcileCanonicalSales({
    localSales,
    centralSales,
    operationalDay: operationalDays[0]
  })
  const canonicalSummaryAll = summarizeCanonicalSales(centralSales)

  const perSaleMetrics = centralSales.map((raw) => {
    const sale = normalizeSale(raw)
    return {
      id: sale.id,
      businessDate: sale.businessDate,
      paymentMethod: sale.paymentMethod,
      subtotal: sale.subtotal,
      total: sale.total,
      discount: sale.discount,
      actualCashDiscount: actualCashDiscountOf(sale),
      saleGross: saleGrossOf(sale),
      saleDiscount: saleDiscountOf(sale),
      saleNet: saleNetOf(sale)
    }
  })

  // 2. Central Sales Period & Operational Day Queries
  const day1Sales = getReportSalesForOperationalDay({
    centralSales,
    operationalDayId: 'op-2026-10-01',
    businessDate: '2026-10-01'
  })
  const twoDaySales = getReportSalesForPeriod({
    localSales,
    centralSales,
    operationalDays,
    from: '2026-10-01',
    to: '2026-10-02',
    currentOperationalDay: operationalDays[0]
  })
  const fullMonthSales = getReportSalesForPeriod({
    localSales,
    centralSales,
    operationalDays,
    from: '2026-10-01',
    to: '2026-10-31',
    currentOperationalDay: operationalDays[0]
  })

  // 3. Comprehensive Report (Single Day, Multi-Day, Full Month)
  const comprehensiveDay1 = calculateComprehensiveSummary(
    day1Sales,
    expenses.filter((e) => e.businessDate === '2026-10-01'),
    transactions.filter((t) => t.businessDate === '2026-10-01'),
    { openingBalance: 50000, actualCash: 60800 }
  )

  const comprehensiveTwoDays = calculateComprehensiveSummary(
    twoDaySales,
    expenses.filter((e) => e.businessDate >= '2026-10-01' && e.businessDate <= '2026-10-02'),
    transactions.filter((t) => t.businessDate >= '2026-10-01' && t.businessDate <= '2026-10-02')
  )

  const comprehensiveFullMonth = calculateComprehensiveSummary(
    fullMonthSales,
    expenses,
    transactions
  )

  // 4. Delivery Discount Report (Baly / Toters / Overall)
  const deliveryDiscountDay1 = buildDeliveryDiscountReport(day1Sales, {
    from: '2026-10-01',
    to: '2026-10-01'
  })
  const deliveryDiscountMonth = buildDeliveryDiscountReport(fullMonthSales, {
    from: '2026-10-01',
    to: '2026-10-31'
  })

  // 5. Shift Reports (Morning, Evening, End-Day)
  const morningShiftReport = buildShiftReport({
    sales: day1Sales,
    expenses,
    transactions,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    shiftType: 'morning'
  })

  const eveningShiftReport = buildShiftReport({
    sales: day1Sales,
    expenses,
    transactions,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    shiftType: 'evening'
  })

  const endDayShiftReport = buildEndDayShiftReport({
    sales: day1Sales,
    expenses,
    transactions,
    businessDate: '2026-10-01',
    operationalDayId: 'op-2026-10-01',
    openingCashBalance: 50000
  })

  // 6. Operational Day Report & Monthly Period Report
  const operationalDay1Report = calculateOperationalDaySummary(
    day1Sales,
    expenses,
    'op-2026-10-01'
  )

  const monthlyFilteredSales = filterRowsByBusinessDate(fullMonthSales, '2026-10-01', '2026-10-31')
  const monthlyFilteredExpenses = filterRowsByBusinessDate(expenses, '2026-10-01', '2026-10-31')
  const monthlyPeriodReport = calculateComprehensiveSummary(
    monthlyFilteredSales,
    monthlyFilteredExpenses,
    transactions
  )

  // 7. Financial Center & Settlement
  const settlementDay1 = calculateSettlement({
    sales: day1Sales,
    expenses: expenses.filter((e) => e.businessDate === '2026-10-01'),
    transactions: transactions.filter((t) => t.businessDate === '2026-10-01'),
    openingBalance: 50000,
    actualCash: 60800
  })

  const financialReportMonth = calculateFinancialReport({
    sales: fullMonthSales,
    expenses,
    transactions,
    from: '2026-10-01',
    to: '2026-10-31',
    openingBalance: 50000
  })

  // 8. Materials Sold Report
  const materialsMonth = buildMaterialsReport({
    sales: fullMonthSales
  })

  return JSON.parse(JSON.stringify({
    perSaleMetrics,
    canonicalReconciliationDay1: {
      count: canonicalDay1.length,
      totalsMatch: reconciledDay1.totalsMatch,
      allowed: reconciledDay1.allowed,
      canonicalSummary: reconciledDay1.canonicalSummary
    },
    canonicalSummaryAll,
    counts: {
      day1SalesCount: day1Sales.length,
      twoDaySalesCount: twoDaySales.length,
      fullMonthSalesCount: fullMonthSales.length
    },
    comprehensiveDay1,
    comprehensiveTwoDays,
    comprehensiveFullMonth,
    deliveryDiscountDay1: deliveryDiscountDay1.totals,
    deliveryDiscountMonth: deliveryDiscountMonth.totals,
    shiftReports: {
      morning: {
        ordersCount: morningShiftReport.ordersCount,
        totalSales: morningShiftReport.totalSales,
        cashSales: morningShiftReport.cashSales,
        electronicSales: morningShiftReport.electronicSales,
        discounts: morningShiftReport.discounts,
        drawerExpenses: morningShiftReport.drawerExpenses,
        withdrawalsTotal: morningShiftReport.withdrawalsTotal,
        netCash: morningShiftReport.netCash
      },
      evening: {
        ordersCount: eveningShiftReport.ordersCount,
        totalSales: eveningShiftReport.totalSales,
        cashSales: eveningShiftReport.cashSales,
        electronicSales: eveningShiftReport.electronicSales,
        discounts: eveningShiftReport.discounts,
        drawerExpenses: eveningShiftReport.drawerExpenses,
        withdrawalsTotal: eveningShiftReport.withdrawalsTotal,
        netCash: eveningShiftReport.netCash
      },
      endDay: {
        totalSales: endDayShiftReport.totalSales,
        cashSales: endDayShiftReport.cashSales,
        electronicSales: endDayShiftReport.electronicSales,
        discounts: endDayShiftReport.discounts,
        expenses: endDayShiftReport.expenses,
        withdrawals: endDayShiftReport.withdrawals,
        deposits: endDayShiftReport.deposits,
        expectedCash: endDayShiftReport.expectedCash
      }
    },
    operationalDay1Summary: operationalDay1Report,
    monthlyPeriodSummary: monthlyPeriodReport,
    settlementDay1,
    financialReportMonth,
    materialsMonthTotals: {
      grandQuantity: materialsMonth.grandQuantity,
      grandTotal: materialsMonth.grandTotal,
      groups: materialsMonth.groups
    }
  }))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename
if (isMain) {
  const snapshot = computeFinancialSnapshot()
  if (process.argv.includes('--write-baseline') || !fs.existsSync(BASELINE_PATH)) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, 2), 'utf8')
    console.log('Financial baseline snapshot generated at:', BASELINE_PATH)
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  assert.deepStrictEqual(
    snapshot,
    baseline,
    'FINANCIAL REGRESSION DETECTED: Old financial result !== New financial result!'
  )

  console.log('Financial Snapshot Baseline Regression Gate: PASSED (BEFORE === AFTER)')
  console.log('Summary of verified baseline metrics:')
  console.log('  Day 1 Gross Sales:', snapshot.comprehensiveDay1.grossSales)
  console.log('  Day 1 Cash Sales:', snapshot.comprehensiveDay1.cashSales)
  console.log('  Day 1 Electronic Sales:', snapshot.comprehensiveDay1.electronicSales)
  console.log('  Day 1 Discounts:', snapshot.comprehensiveDay1.discounts)
  console.log('  Day 1 Baly (Orig / Discount / Final):', snapshot.deliveryDiscountDay1.baly.originalTotal, '/', snapshot.deliveryDiscountDay1.baly.discount, '/', snapshot.deliveryDiscountDay1.baly.finalTotal)
  console.log('  Day 1 Toters (Orig / Discount / Final):', snapshot.deliveryDiscountDay1.toters.originalTotal, '/', snapshot.deliveryDiscountDay1.toters.discount, '/', snapshot.deliveryDiscountDay1.toters.finalTotal)
  console.log('  Month Gross Sales:', snapshot.comprehensiveFullMonth.grossSales)
  console.log('  Month Net After Discount:', snapshot.comprehensiveFullMonth.netAfterDiscount)
  console.log('  Month Discounts:', snapshot.comprehensiveFullMonth.discounts)
  console.log('  Month Delivery Discounts Overall:', snapshot.deliveryDiscountMonth.overall.discount)
  console.log('  Month Final After All Settlements:', snapshot.comprehensiveFullMonth.finalAfterAllSettlements)
}
