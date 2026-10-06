import assert from 'node:assert/strict'
import { buildCaptainReport, filterCaptainCandidates, matchCaptainRecord } from '../src/services/captainReport.js'

const staff = [{ id: 'c1', code: 'CAP-01', name: 'علي', active: true }, { id: 'c2', code: 'CAP-02', name: 'روان', active: true }]
const sales = [{ id: 'sale-1', orderNumber: 101, employeeId: 'c1', seller: 'علي', businessDate: '2026-10-06', paymentMethod: 'cash', total: 1000 }, { id: 'sale-2', cashierNameSnapshot: 'روان', businessDate: '2026-10-06', paymentMethod: 'electronic', total: 500 }]
const expenses = [{ id: 'salary-1', employeeId: 'c1', category: 'راتب', amount: 100, businessDate: '2026-10-06', notes: 'راتب علي' }, { id: 'captain-expense', employeeNameSnapshot: 'علي', category: 'نقل', amount: 50, businessDate: '2026-10-06', notes: 'أجرة نقل' }, { id: 'general-expense', category: 'مشتريات', amount: 900, businessDate: '2026-10-06', notes: 'شراء حليب' }]
const transactions = [{ id: 'withdrawal-1', type: 'withdrawal', cashierId: 'c1', amount: 25, businessDate: '2026-10-06', note: 'سحب' }, { id: 'withdrawal-general', type: 'withdrawal', amount: 999, businessDate: '2026-10-06', note: 'عام' }]

assert.equal(filterCaptainCandidates(staff, 'CAP-01')[0].id, 'c1')
assert.equal(filterCaptainCandidates(staff, 'علي')[0].id, 'c1')
assert.equal(matchCaptainRecord({ cashierId: 'c1' }, staff[0], staff), true)
assert.equal(matchCaptainRecord({ category: 'مشتريات' }, staff[0], staff), false)
const all = buildCaptainReport({ captain: staff[0], staff, sales, expenses, transactions, from: '2026-10-01', to: '2026-10-31', sections: ['sales', 'expenses', 'withdrawals', 'salary'] })
assert.equal(all.sales.length, 1); assert.equal(all.salesTotal, 1000); assert.equal(all.expenses.length, 1); assert.equal(all.expensesTotal, 50); assert.equal(all.salary.length, 1); assert.equal(all.salaryTotal, 100); assert.equal(all.withdrawals.length, 1); assert.equal(all.withdrawalsTotal, 25); assert.equal(all.netTotal, 825)
const salesOnly = buildCaptainReport({ captain: staff[0], staff, sales, expenses, transactions, from: '2026-10-01', to: '2026-10-31', sections: ['sales', 'withdrawals'] })
assert.equal(salesOnly.expenses.length, 0); assert.equal(salesOnly.salary.length, 0); assert.equal(salesOnly.netTotal, 975)
console.log(JSON.stringify({ SALARY_CATEGORY: 'PASS', CAPTAIN_ONLY_EXPENSES: 'PASS', GENERAL_SHOP_EXPENSE_EXCLUDED: 'PASS', CAPTAIN_SALES: 'PASS', CAPTAIN_WITHDRAWALS: 'PASS', CAPTAIN_SALARY: 'PASS', CAPTAIN_SEARCH_NAME: 'PASS', CAPTAIN_SEARCH_CODE: 'PASS', SECTION_SELECTION: 'PASS', NO_DOUBLE_COUNT_SALARY: 'PASS' }, null, 2))
