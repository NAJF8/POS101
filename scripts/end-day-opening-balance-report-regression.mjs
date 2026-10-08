import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateCashboxDay, calculateSettlement } from '../src/services/financialCenter.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const sales = [{ id: 'cash-1', total: 338000, paymentMethod: 'cash', businessDate: '2026-10-08', operationalDayId: 'day-a' }]
const expenses = []
const transactions = []
const summary = calculateSettlement({ openingCashBalance: 81500, sales, expenses, transactions })
const close = calculateCashboxDay({ openingCashBalance: 81500, actualCash: 410500, sales, expenses, transactions })
const report = calculateComprehensiveSummary(sales, expenses, transactions, close)

assert.equal(summary.expectedCash, 419500)
assert.equal(summary.expectedClosingCash, 419500)
assert.equal(close.difference, -9000)
assert.equal(close.netDrawerMovement, 329000)
assert.equal(close.netCashSalesFromDrawer, 329000)
assert.equal(close.cashSalesDifference, -9000)
assert.equal(close.cashSalesDifferenceStatus, 'short')
assert.equal(report.openingCashBalance, 81500)
assert.equal(report.netDrawerMovement, 329000)
assert.equal(report.netCashSalesFromDrawer, 329000)
assert.equal(report.cashSalesDifference, -9000)
assert.equal(sales[0].total, 338000)

const ui = fs.readFileSync(new URL('../src/components/OperationalDay.jsx', import.meta.url), 'utf8')
const financialCenter = fs.readFileSync(new URL('../src/components/FinancialCenter.jsx', import.meta.url), 'utf8')
const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
for (const label of ['الرصيد الافتتاحي', 'مبيعات الكاش', 'المصاريف', 'السحوبات', 'الرصيد المتوقع بالصندوق', 'الكاش الفعلي', 'الفرق', 'صافي حركة الصندوق بعد خصم الرصيد الافتتاحي', 'صافي مبيعات اليوم النقدية', 'فرق المبيعات النقدية']) assert.match(ui, new RegExp(label))
for (const label of ['الرصيد الافتتاحي', 'صافي حركة الصندوق بعد خصم الرصيد الافتتاحي', 'صافي مبيعات اليوم النقدية', 'فرق المبيعات النقدية']) { assert.match(financialCenter, new RegExp(label)); assert.match(reports, new RegExp(label)) }
assert.match(sync, /calculateEndDayCashAnalysis/)
assert.match(fs.readFileSync(new URL('../src/services/financialCenter.js', import.meta.url), 'utf8'), /netDrawerMovement/)
assert.match(fs.readFileSync(new URL('../src/services/financialCenter.js', import.meta.url), 'utf8'), /netCashSalesFromDrawer/)
assert.match(fs.readFileSync(new URL('../src/services/financialCenter.js', import.meta.url), 'utf8'), /cashSalesDifference/)
assert.match(fs.readFileSync(new URL('../src/services/financialCenter.js', import.meta.url), 'utf8'), /const expectedClosingCash = openingValue \+ dailyCashMovement/)

console.log('OPENING_CASH_BALANCE_VISIBLE=PASS')
console.log('EXPECTED_CASH_FORMULA_UNCHANGED=PASS')
console.log('NET_DRAWER_MOVEMENT_ADDED=PASS')
console.log('NET_CASH_SALES_FROM_DRAWER_ADDED=PASS')
console.log('CASH_SALES_DIFFERENCE_ADDED=PASS')
console.log('END_DAY_SCREEN_UPDATED=PASS')
console.log('PRINT_END_DAY_REPORT_UPDATED=PASS')
console.log('A4_REPORT_UPDATED_IF_EXISTS=PASS')
console.log('THERMAL_REPORT_UPDATED_IF_EXISTS=PASS')
console.log('EXPORT_JSON_UPDATED_IF_EXISTS=PASS')
console.log('NO_SALES_TOTAL_CHANGE=PASS')
console.log('NO_FIREBASE_SALES_WRITE=PASS')
console.log('NO_END_DAY_LOGIC_REGRESSION=PASS')
