import assert from 'node:assert/strict'
import { areExpenseDuplicates, getExpensesForBusinessDate } from '../src/services/expenseReporting.js'

const store = new Map([
  ['pos101.expenses', JSON.stringify([{ id: 'existing', amount: 100, businessDate: '2026-10-03', notes: 'موجود', createdAt: 1791050000000 }])],
  ['pos101.fullRecoveryBackup.old', JSON.stringify({ snapshot: { expenses: [
    { id: 'duplicate', amount: 100, businessDate: '2026-10-03', notes: 'موجود', createdAt: 1791050000500 },
    { id: 'new-1', amount: '5,000', date: '2026-10-02T10:00:00+03:00', category: 'مشتريات' },
    { id: 'new-2', amount: '٢٬٠٠٠', createdAt: '2026-10-01T22:00:00Z', description: 'نقل' },
    { id: 'new-3', amount: 300, operationalDayId: 'day-2', notes: 'صيانة' },
  ] } })],
  ['pos101_operational_days', JSON.stringify({ 'day-2': { id: 'day-2', businessDate: '2026-10-02' } })],
])
globalThis.localStorage = {
  get length() { return store.size },
  key: index => [...store.keys()][index] ?? null,
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}

const { scanAllExpenseBackups, parseManualExpenseBulk } = await import('../src/services/fullRecoveryController.js')
const scan = scanAllExpenseBackups()
assert.equal(scan.scannedKeys, 3)
assert.equal(scan.currentCount, 1)
assert.equal(scan.newCount, 4)
assert.equal(scan.duplicateCount, 0)
assert.equal(scan.withoutDateCount, 0)
assert.equal(scan.recoverableTotal, 7400)
assert.equal(scan.candidates.find(row => row.id === 'new-3').businessDate, '2026-10-02')
assert.equal(getExpensesForBusinessDate(scan.candidates, '2026-10-02').length, 3)
assert.equal(areExpenseDuplicates(scan.candidates[0], scan.candidates[0]), true)

const parsed = parseManualExpenseBulk('2026-10-02 | 5,000 | مشتريات | علي | شراء حليب\n2026-10-02 | ٢٬٠٠٠ | نقل | محمد | أجرة نقل\n2026-10-01 | 10000 | صيانة | علي | صيانة جهاز')
assert.equal(parsed.length, 3)
assert.equal(parsed.filter(row => row.valid).length, 3)
assert.equal(parsed[1].expense.amount, 2000)
assert.equal(parsed[1].expense.recoverySource, 'manual-bulk-recovery')
console.log('EXPENSE_RECOVERY_DEEP_REGRESSION=PASS')
