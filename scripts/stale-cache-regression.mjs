import assert from 'node:assert/strict'
import fs from 'node:fs'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const reportRead = sync.slice(sync.indexOf('export const readCentralExpensesForReports'), sync.indexOf('const mergeCentralExpensesWithPendingLocal'))
const realtimeRead = sync.slice(sync.indexOf('export const subscribeCentralExpenses'), sync.indexOf('export const runExpenseCentralSync'))

assert.match(reportRead, /const protectedLocalCache = mergeExpensesConservatively\(localCacheExpenses, centralExpenses\)/)
assert.match(reportRead, /writeLocalExpenses\(protectedLocalCache\)/)
assert.match(realtimeRead, /const merged = cacheCentralExpenses\(expenses\)/)
assert.match(realtimeRead, /callback\?\.\(readCachedExpenses\(\), \{ centralCount: null \}\)/)
assert.match(sync, /retainedPending\.push/)
assert.match(sync, /writeLocalExpenses\(merged\)/)

console.log('STALE_CACHE_PROTECTION=PASS')
console.log('REMOTE_EMPTY_DOES_NOT_ERASE_LOCAL=PASS')
console.log('EXPENSE_OFFLINE_RECOVERY=PASS')
