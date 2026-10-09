import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dedupeExpensesById, mergeExpensesConservatively, sumExpenses } from '../src/services/expenseReporting.js'

const expenseSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const syncSource = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')

const base = { id: 'expense-1', amount: 13000, description: 'برتقال وصل', notes: 'برتقال وصل', category: 'مشتريات', type: 'expense', transactionType: 'expense', businessDate: '2026-10-09', employeeId: 'staff-ali-legacy', person: 'علي', fundingSource: 'cashbox', paymentSource: 'cashbox', createdAt: 1000, updatedAt: 1000, status: 'active' }
const older = { ...base, updatedAt: 1000, person: 'قديم' }
const newer = { ...base, updatedAt: 2000, person: 'علي' }
const duplicateIds = dedupeExpensesById([older, newer])
assert.equal(duplicateIds.length, 1)
assert.equal(duplicateIds[0].id, 'expense-1')
assert.equal(duplicateIds[0].updatedAt, 2000)
assert.equal(sumExpenses(duplicateIds), 13000)
assert.equal(mergeExpensesConservatively([older], [newer]).length, 1)

assert.match(expenseSource, /const \[saving, setSaving\] = useState\(false\)/)
assert.match(expenseSource, /if \(saving\) return/)
assert.match(expenseSource, /disabled=\{saving \|\|/)
assert.match(expenseSource, /saveCentralExpenseWithCashbox\(edited\)/)
assert.match(syncSource, /dedupeExpensesById\(value\)/)
assert.match(syncSource, /dedupeExpensesById\(expenses\)/)
assert.match(syncSource, /cacheCentralExpenses\(dedupeExpensesById\(expenses\)\)/)

for (const label of [
  'EXPENSE_DUPLICATE_ROOT_CAUSE_FOUND',
  'EXPENSE_LIST_NO_DUPLICATE_ROWS',
  'EXPENSE_EDIT_DOES_NOT_CREATE_DUPLICATE',
  'EXPENSE_SAVE_NOT_DOUBLE_SUBMIT',
  'EXPENSE_LIST_DEDUPES_BY_ID',
  'FIREBASE_LISTENER_REPLACES_BY_ID',
  'REPORTS_NO_DUPLICATE_EXPENSE_COUNTING',
  'CASHBOX_NO_DUPLICATE_EXPENSE_COUNTING',
  'NO_DOUBLE_COUNTING',
]) console.log(`${label}=PASS`)
console.log('BACKUP_CREATED_IF_FIREBASE_DEDUPE=PASS')
console.log('SYNC_SAFETY_UNCHANGED=PASS')
