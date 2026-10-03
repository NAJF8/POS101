import assert from 'node:assert/strict'
import fs from 'node:fs'

const store = new Map([
  ['pos101.expenses', JSON.stringify([{ id: 'local-1', amount: 1000, businessDate: '2026-09-27', description: 'محلي', createdAt: 1790791200000 }])],
  ['pos101.fullRecoveryBackup.old', JSON.stringify({ expenses: [
    { id: 'old-1', amount: 2000, businessDate: '2026-10-02', description: 'قديم 1', createdAt: 1790956800000 },
    { id: 'old-2', amount: 3000, businessDate: '2026-10-02', description: 'قديم 2', createdAt: 1790956801000 },
  ] })],
])
globalThis.localStorage = {
  get length() { return store.size },
  key: index => [...store.keys()][index] ?? null,
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
globalThis.window = { location: { hostname: 'example.test' }, dispatchEvent() {} }

const { createMasterExpenseRecoveryHandler } = await import('../src/services/fullRecoveryController.js')
let reads = 0
const handler = createMasterExpenseRecoveryHandler({
  getCurrentUser: () => ({ uid: 'admin-1', email: 'admin@example.test', authorization: { role: 'admin', active: true, authorized: true } }),
  readCentral: async () => {
    reads += 1
    const centralExpenses = [{ id: 'central-1', amount: 500, businessDate: '2026-09-27', description: 'مركزي', createdAt: 1790791200000 }]
    return { expenses: centralExpenses, centralExpenses, centralCount: centralExpenses.length, mergedCount: centralExpenses.length + 3 }
  },
  syncCentral: async () => ({ uploaded: 2, skipped: 1 }),
})
const result = await handler()
assert.equal(reads, 2)
assert.equal(result.localBefore, 1)
assert.equal(result.backupCandidatesFound, 2)
assert.equal(result.firebaseBefore, 1)
assert.equal(result.uploaded, 2)
assert.equal(result.pendingRetained, 0)
assert.ok([...store.keys()].some(key => key.startsWith('pos101.masterExpenseRecoveryBackup.')))

const expensesSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
assert.match(expensesSource, /مزامنة واسترجاع كل المصاريف/)
assert.doesNotMatch(expensesSource, /placeholder=\{['"]2026-10-02 \| 5000/)
console.log('MASTER_EXPENSE_RECOVERY_REGRESSION=PASS')
