import assert from 'node:assert/strict'
import { areExpenseDuplicates, mergeExpensesConservatively } from '../src/services/expenseReporting.js'

const local = [
  { id: 'pending-1', amount: 1000, notes: 'حليب', businessDate: '2026-10-02', createdAt: 1790970000000, cashierId: 'cashier-1', syncStatus: 'pending' },
  { id: 'legacy-1', amount: 2500, notes: 'ثلج', businessDate: '2026-10-03', createdAt: 1791050000000, cashierId: 'cashier-1' },
]
const remote = [{ id: 'remote-1', amount: 1000, description: 'حليب', businessDate: '2026-10-02', createdAt: 1790970000500, cashierId: 'cashier-1' }]

assert.equal(areExpenseDuplicates(local[0], remote[0]), true)
assert.equal(mergeExpensesConservatively(local, remote).length, 2)
assert.equal(mergeExpensesConservatively(local, []).length, 2)
assert.equal(mergeExpensesConservatively([], remote).length, 1)
assert.equal(areExpenseDuplicates({ ...local[0], amount: 1001 }, remote[0]), false)
assert.equal(areExpenseDuplicates({ ...local[0], cashierId: 'other' }, remote[0]), false)
console.log('EXPENSE_RECOVERY_REGRESSION=PASS')
