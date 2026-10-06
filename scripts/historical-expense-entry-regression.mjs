import assert from 'node:assert/strict'
import { getExpensesForBusinessDate, matchOperationalDayByBusinessDate, normalizeExpense } from '../src/services/expenseReporting.js'

const currentDay = { id: 'day-current', businessDate: '2026-10-05', status: 'open' }
const historicalDay = { id: 'day-0927', businessDate: '2026-09-27', status: 'closed' }
const current = normalizeExpense({ id: 'current', amount: '1200', description: 'حليب', businessDate: currentDay.businessDate, operationalDayId: currentDay.id, entryType: 'current' })
const historical = normalizeExpense({ id: 'historical', amount: '750', description: 'صيانة', businessDate: '2026-09-27', operationalDayId: historicalDay.id, entryType: 'historical' })

assert.equal(current.businessDate, '2026-10-05')
assert.equal(current.entryType, 'current')
assert.equal(historical.businessDate, '2026-09-27')
assert.equal(historical.entryType, 'historical')
assert.equal(getExpensesForBusinessDate([current, historical], '2026-09-27').length, 1)
assert.equal(getExpensesForBusinessDate([current, historical], '2026-10-05').length, 1)
assert.equal(matchOperationalDayByBusinessDate([currentDay, historicalDay], '2026-09-27').operationalDayId, 'day-0927')
assert.equal(matchOperationalDayByBusinessDate([currentDay], '2026-09-27').operationalDayId, '')
assert.equal(matchOperationalDayByBusinessDate([historicalDay, { ...historicalDay, id: 'day-0927-duplicate' }], '2026-09-27').ambiguous, true)
assert.equal(matchOperationalDayByBusinessDate([currentDay], '2026-10-06').operationalDayId, '')

console.log('CURRENT_EXPENSE_BUSINESS_DATE = PASS')
console.log('HISTORICAL_EXPENSE_DATE = PASS')
console.log('HISTORICAL_NO_FUTURE_DATE = PASS')
console.log('HISTORICAL_DAY_MATCH = PASS')
console.log('HISTORICAL_NOT_LINKED_TO_CURRENT_DAY = PASS')
console.log('REPORT_HISTORICAL_EXPENSE = PASS')
