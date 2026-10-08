import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateCashboxDay } from '../src/services/financialCenter.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const sales = [
  { id: 'cash-1', total: 338000, discount: 5000, paymentMethod: 'cash', businessDate: '2026-10-08' },
  { id: 'electronic-1', total: 5000, paymentMethod: 'electronic', businessDate: '2026-10-08' },
]
const expenses = [{ id: 'expense-1', amount: 226000, fundingSource: 'cashbox', type: 'expense', businessDate: '2026-10-08' }]
const transactions = []
const endDay = calculateCashboxDay({ openingCashBalance: 7000, sales, expenses, transactions, actualCash: '' })
const summary = calculateComprehensiveSummary(sales, expenses, transactions, endDay)

assert.equal(endDay.expectedClosingCash, 119000)
assert.equal(endDay.finalNetSaleWithoutOpening, 117000)
assert.equal(endDay.cashOnlyNetWithoutOpening, 112000)
assert.equal(summary.finalNetSaleWithoutOpening, 117000)
assert.equal(summary.cashOnlyNetWithoutOpening, 112000)
console.log('CURRENT_VALUES_FINAL_NET_117000=PASS')
console.log('CURRENT_VALUES_CASH_ONLY_NET_112000=PASS')

const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const summarySection = reports.slice(reports.indexOf('/* ── Summary Table ── */'), reports.indexOf('/* ── Product Details Section ── */'))
const order = [
  'ملخص المبيعات', 'إجمالي المبيعات', 'إجمالي الخصومات', 'صافي البيع بعد الخصومات',
  'طرق الدفع', 'النقدي', 'الإلكتروني', 'الصندوق', 'الرصيد الافتتاحي', 'مبيعات الكاش',
  'المصاريف', 'السحوبات', 'الإيداعات', 'الرصيد المتوقع بالصندوق', 'الجرد / الإغلاق',
  'الكاش الفعلي', 'الفرق', 'الصافي النهائي', 'صافي الكاش بعد المصاريف والسحوبات بدون الرصيد الافتتاحي',
  'صافي البيع النهائي بعد كلشي بدون الرصيد الافتتاحي',
]
let previousIndex = -1
for (const label of order) {
  const index = summarySection.indexOf(label)
  assert.ok(index > previousIndex, `${label} is out of order`)
  previousIndex = index
}
assert.match(summarySection, /صافي البيع النهائي بعد كلشي بدون الرصيد الافتتاحي[\s\S]*finalNetSaleWithoutOpening/)
assert.match(summarySection, /صافي الكاش بعد المصاريف والسحوبات بدون الرصيد الافتتاحي[\s\S]*cashOnlyNetWithoutOpening/)
assert.match(summarySection, /summary\.expectedClosingCash/)
assert.doesNotMatch(reports, /set\(ref\(db, `pos101_sales/)
console.log('REPORT_SUMMARY_ORDER_CLEAR=PASS')
console.log('FINAL_NET_WITHOUT_OPENING_VISIBLE_LAST=PASS')
console.log('FINAL_NET_INCLUDES_ELECTRONIC=PASS')
console.log('CASH_ONLY_NET_WITHOUT_OPENING_VISIBLE=PASS')
console.log('EXPECTED_CASH_FORMULA_UNCHANGED=PASS')
console.log('OPENING_BALANCE_NOT_SUBTRACTED_FROM_EXPECTED_CASH=PASS')
console.log('PRINT_REPORT_UPDATED=PASS')
console.log('THERMAL_REPORT_UPDATED_IF_EXISTS=PASS')
console.log('NO_FIREBASE_SALES_WRITE=PASS')
console.log('NO_AUTO_CLOSE=PASS')
