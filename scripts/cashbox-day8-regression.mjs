import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCashboxReportData, buildCashboxReportRows, calculateFinancialReport } from '../src/services/financialCenter.js'
import { getReportSalesForPeriod } from '../src/services/reportSales.js'

const day = { id: 'operational-day-2026-10-08', businessDate: '2026-10-08', openingCashBalance: 7000, status: 'closed', startedAt: 1, endedAt: 2 }
const sales = [
  { id: 'cash-1', total: 342000, paymentMethod: 'cash', businessDate: '2026-10-08', operational_day_id: 'legacy-day-key', status: 'completed' },
  { id: 'electronic-1', total: 5000, paymentMethod: 'electronic', businessDate: '2026-10-08', status: 'sold' },
  { id: 'voided-pending', total: 200000, paymentMethod: 'cash', businessDate: '2026-10-08', status: 'voided', operationalDayId: day.id },
  { id: 'cancelled-pending', total: 100000, paymentMethod: 'cash', businessDate: '2026-10-08', status: 'cancelled', operationalDayId: day.id },
]
const expenses = [{ id: 'drawer-expense', amount: 127000, type: 'expense', fundingSource: 'cashbox', businessDate: '2026-10-08' }]
const transactions = [{ id: 'drawer-withdrawal', amount: 115500, type: 'withdrawal', fundingSource: 'cashbox', businessDate: '2026-10-08', status: 'active' }]
const rows = buildCashboxReportRows({ operationalDays: [day], settlements: [{ id: 'settlement-day8', operationalDayId: day.id, businessDate: day.businessDate, openingCashBalance: 0, expectedCash: -242500 }], sales, expenses, transactions })
const report = rows[0]
assert.equal(report.openingCashBalance, 7000)
assert.equal(report.salesRecordsMatched, 2)
assert.equal(report.sales, 347000)
assert.equal(report.cashSales, 342000)
assert.equal(report.electronicSales, 5000)
assert.equal(report.drawerExpenses, 127000)
assert.equal(report.drawerWithdrawals, 115500)
assert.equal(report.expectedClosingCash, 106500)
assert.equal(report.excludedVoidedSalesCount, 1)
assert.equal(report.excludedCancelledSalesCount, 1)
assert.equal(report.withdrawals, 115500)

const fallbackData = buildCashboxReportData({
  from: day.businessDate,
  to: day.businessDate,
  operationalDays: [],
  settlements: [{ id: 'settlement-day8-fallback', operationalDayId: day.id, businessDate: day.businessDate, openingCashBalance: 7000 }],
  sales: sales.map(({ businessDate, ...sale }) => ({ ...sale, business_date: businessDate })),
  expenses,
  transactions,
})
const fallback = fallbackData.selected
assert.ok(fallback?.day.fallbackFromBusinessDate)
assert.equal(fallback.openingCashBalance, 7000)
assert.equal(fallback.sales, 347000)
assert.equal(fallback.cashSales, 342000)
assert.equal(fallback.electronicSales, 5000)
assert.equal(fallback.expectedClosingCash, 106500)
assert.equal(fallbackData.dailyRows[0].sales, 347000)
assert.equal(fallbackData.dailyRows[0].expectedCash, 106500)
assert.equal(fallback.day.id, 'business-date:2026-10-08')
const rangeData = buildCashboxReportData({ from: '2026-10-08', to: '2026-10-09', operationalDays: [], settlements: [{ id: 'settlement-day8-range', businessDate: day.businessDate, openingCashBalance: 7000 }], sales: sales.map(({ businessDate, ...sale }) => ({ ...sale, business_date: businessDate })), expenses, transactions })
assert.equal(rangeData.summary.sales, 347000)
assert.equal(rangeData.summary.expectedCash, 106500)

const period = calculateFinancialReport({ sales, expenses, transactions, from: '2026-10-08', to: '2026-10-08' })
assert.equal(period.sales, 347000)
assert.equal(period.cashSales, 342000)
assert.equal(period.electronicSales, 5000)
assert.equal(period.daily[0].expenses, 127000)
assert.equal(period.daily[0].withdrawals, 115500)
const centralReportSales = getReportSalesForPeriod({ centralSales: sales, operationalDays: [day], from: day.businessDate, to: day.businessDate })
assert.deepEqual(centralReportSales.map(row => row.id), ['cash-1', 'electronic-1'])

const financialSource = fs.readFileSync(new URL('../src/services/financialCenter.js', import.meta.url), 'utf8')
const centerSource = fs.readFileSync(new URL('../src/components/FinancialCenter.jsx', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
assert.match(financialSource, /resolveFinancialBusinessDate\(row, dayDates\) === day\.businessDate/)
assert.match(financialSource, /dayOpening = day\.openingCashBalance \?\? day\.openingBalance/)
assert.match(centerSource, /CASHBOX_VISIBLE_DIAGNOSTIC/)
assert.match(centerSource, /displayedReport\.expectedCash \?\? displayedReport\.expectedClosingCash/)
assert.match(centerSource, /buildCashboxReportData/)
assert.match(centerSource, /cashboxReportData\.dailyRows/)
assert.match(centerSource, /LIVE_BUILD_META/)
assert.match(centerSource, /CASHBOX_VISIBLE_DIAGNOSTIC/)
assert.doesNotMatch(centerSource, /ID: \{row\.day\.id\}/)
assert.match(appSource, /cashboxSales=\{adminCentralSales\}/)
assert.match(appSource, /adminCentralSales\.length/)
assert.doesNotMatch(financialSource + centerSource + appSource, /set\(ref\(db, `pos101_sales/)
assert.doesNotMatch(centerSource, /localStorage\.clear\(/)

console.log(JSON.stringify({
  CASHBOX_DAY8_SALES_INCLUDED: 'PASS',
  CASHBOX_DAY8_OPENING_BALANCE_INCLUDED: 'PASS',
  CASHBOX_DAY8_EXPECTED_106500: 'PASS',
  CASHBOX_USES_BUSINESS_DATE_FOR_SALES: 'PASS',
  CASHBOX_USES_BUSINESS_DATE_FOR_EXPENSES: 'PASS',
  VOIDED_PENDING_ORDERS_EXCLUDED: 'PASS',
  DRAWER_EXPENSES_SUBTRACTED_ONCE: 'PASS',
  DRAWER_WITHDRAWALS_SUBTRACTED_ONCE: 'PASS',
  NO_DOUBLE_COUNTING: 'PASS',
  SYNC_SAFETY_UNCHANGED: 'PASS',
}, null, 2))
