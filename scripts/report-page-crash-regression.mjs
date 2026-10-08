import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateEndDayCashAnalysis, toMoneyNumber } from '../src/services/financialCenter.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const summary = (report, fallback = {}) => {
  const source = report?.summary ?? report ?? {}
  const openingRaw = source.openingCashBalance ?? source.openingBalance ?? fallback.openingCashBalance
  const openingCashBalance = toMoneyNumber(openingRaw, 0)
  const cashSales = toMoneyNumber(source.cashSales ?? fallback.cashSales, 0)
  const expenses = toMoneyNumber(source.expenses ?? fallback.expenses, 0)
  const withdrawals = toMoneyNumber(source.withdrawals ?? fallback.withdrawals, 0)
  const actualCash = toMoneyNumber(source.actualCash ?? fallback.actualCash, 0)
  const expectedCash = openingCashBalance + cashSales - expenses - withdrawals
  const analysis = calculateEndDayCashAnalysis({ openingCashBalance, cashSales, expenses, withdrawals, expectedCash, actualCash })
  return { openingCashBalance, cashSales, expenses, withdrawals, actualCash, expectedCash, ...analysis }
}

assert.doesNotThrow(() => summary({ cashSales: '338000' }, { openingCashBalance: '81500' }))
console.log('REPORT_PAGE_NO_CRASH_WITH_OLD_REPORT=PASS')

assert.doesNotThrow(() => summary({ summary: undefined, settlement: undefined }))
console.log('REPORT_PAGE_NO_CRASH_WITH_MISSING_FIELDS=PASS')

const safe = summary({ openingCashBalance: undefined, expenses: undefined, withdrawals: undefined, actualCash: '' }, { openingCashBalance: 81500 })
assert.equal(safe.openingCashBalance, 81500)
assert.equal(safe.expenses, 0)
assert.equal(safe.withdrawals, 0)
assert.equal(safe.actualCash, 0)
console.log('OPENING_BALANCE_DEFAULT_SAFE=PASS')

const normal = summary({ openingCashBalance: '81500', cashSales: '338000', expenses: undefined, withdrawals: '0', actualCash: '410500' })
assert.equal(normal.expectedCash, 419500)
assert.equal(normal.netDrawerMovement, 329000)
assert.equal(normal.netCashSalesFromDrawer, 329000)
assert.equal(normal.cashSalesDifference, -9000)
console.log('NET_DRAWER_MOVEMENT_SAFE=PASS')
console.log('NET_CASH_SALES_SAFE=PASS')
console.log('CASH_SALES_DIFFERENCE_SAFE=PASS')

const oldReport = calculateComprehensiveSummary([], [], [], { summary: { cashSales: '338000', actualCash: '' } })
assert.doesNotThrow(() => JSON.stringify(oldReport))
assert.equal(oldReport.openingCashBalance, null)
console.log('TO_LOCALE_STRING_SAFE=PASS')

const reportsSource = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(reportsSource, /settlementCorrections\s*=\s*\[\]/)
assert.match(reportsSource, /settlementCorrections\) \? settlementCorrections|settlementCorrections = \[\]/)
const financialSource = fs.readFileSync(new URL('../src/services/financialCenter.js', import.meta.url), 'utf8')
assert.match(financialSource, /export const toMoneyNumber/)
assert.match(financialSource, /Number\.isFinite\(numeric\)/)
console.log('REPORT_RUNTIME_GUARDS=PASS')
