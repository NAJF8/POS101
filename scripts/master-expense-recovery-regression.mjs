import assert from 'node:assert/strict'
import fs from 'node:fs'

const store = new Map([
  ['pos101.expenses', JSON.stringify([{ id: 'local-1', amount: 1000, businessDate: '2026-09-27', description: 'محلي', createdAt: 1790791200000 }])],
  ['pos101.fullRecoveryBackup.old', JSON.stringify({ expenses: [
    { id: 'central-duplicate', amount: 2000, businessDate: '2026-10-02', description: 'موجود مركزي', person: 'علي', createdAt: 1790956800000 },
    { id: 'old-1', amount: 3000, businessDate: '2026-10-02', description: 'قديم 1', person: 'علي', createdAt: 1790956900000 },
    { id: 'old-2', amount: 4000, businessDate: '2026-10-02', description: 'قديم 2', person: 'محمد', createdAt: 1790957000000 },
    { id: '', amount: 5000, businessDate: '2026-09-27', description: 'قديم بلا وقت', person: 'حسن' },
  ] })],
])
globalThis.localStorage = {
  get length() { return store.size },
  key: index => [...store.keys()][index] ?? null,
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
globalThis.window = { location: { hostname: 'example.test' }, dispatchEvent() {} }

const { createMasterExpenseRecoveryHandler, classifyRecoveryCandidates } = await import('../src/services/fullRecoveryController.js')
let reads = 0
const handler = createMasterExpenseRecoveryHandler({
  getCurrentUser: () => ({ uid: 'admin-1', email: 'admin@example.test', authorization: { role: 'admin', active: true, authorized: true } }),
  readCentral: async () => {
    reads += 1
    const centralExpenses = reads === 1
      ? [
          { id: 'central-1', amount: 500, businessDate: '2026-09-27', description: 'مركزي', createdAt: 1790791200000 },
          { id: 'central-duplicate', amount: 2000, businessDate: '2026-10-02', description: 'موجود مركزي', person: 'علي', createdAt: 1790956800000 },
          { id: 'central-3', amount: 700, businessDate: '2026-09-28', description: 'قديم مركزي 3', createdAt: 1790870400000 },
          { id: 'central-4', amount: 800, businessDate: '2026-09-29', description: 'قديم مركزي 4', createdAt: 1790956800000 },
        ]
      : Array.from({ length: 7 }, (_, index) => ({ id: `after-${index}`, amount: 1, businessDate: '2026-10-02', description: `after-${index}`, createdAt: 1790956800000 }))
    return { expenses: centralExpenses, centralExpenses, centralCount: centralExpenses.length, mergedCount: centralExpenses.length + 1 }
  },
  syncCentral: async () => ({ uploaded: 3, skipped: 0, retainedPending: 0 }),
})
const result = await handler()
assert.equal(reads, 2)
assert.equal(result.localBefore, 1)
assert.equal(result.backupCandidatesFound, 4)
assert.equal(result.firebaseBefore, 4)
assert.equal(result.uniqueCandidates, 3)
assert.equal(result.duplicateCandidates, 1)
assert.equal(result.uploaded, 3)
assert.equal(result.firebaseAfter, 7)
assert.equal(result.invariantOk, true)
assert.equal(result.pendingRetained, 0)
assert.ok([...store.keys()].some(key => key.startsWith('pos101.masterExpenseRecoveryBackup.')))

const noCreatedAt = result.candidateDiagnostics.find(row => row.description === 'قديم بلا وقت')
assert.match(noCreatedAt.id, /^recovered-expense-/)
assert.ok(noCreatedAt.createdAt > 0)
assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(noCreatedAt.createdAt)), '2026-09-27')
assert.equal(classifyRecoveryCandidates([{ id: 'central-duplicate', amount: 99, businessDate: '2026-10-02' }], [{ id: 'central-duplicate', amount: 1, businessDate: '2026-01-01' }])[0].decision, 'DUPLICATE')

const expensesSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
assert.match(expensesSource, /مزامنة واسترجاع كل المصاريف/)
assert.doesNotMatch(expensesSource, /placeholder=\{['"]2026-10-02 \| 5000/)
console.log('MASTER_EXPENSE_RECOVERY_REGRESSION=PASS')
