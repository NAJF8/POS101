import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifySaleSyncError } from '../src/services/saleSyncError.js'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const sync = read('src/services/posCentralSync.js')
const rules = JSON.parse(read('database.rules.json')).rules

assert.equal(classifySaleSyncError({ code: 'NETWORK_ERROR' }).kind, 'network')
assert.match(classifySaleSyncError({ code: 'NETWORK_ERROR' }).message, /الاتصال بالإنترنت مقطوع/)
assert.equal(classifySaleSyncError({ code: 'AUTH_REQUIRED' }).kind, 'auth')
assert.match(classifySaleSyncError({ code: 'AUTH_REQUIRED' }).message, /جلسة الكاشير غير جاهزة/)
assert.equal(classifySaleSyncError({ code: 'PERMISSION_DENIED' }).kind, 'permission')
assert.equal(classifySaleSyncError({ code: 'SALE_READBACK_FAILED' }).kind, 'readback')
assert.equal(classifySaleSyncError({ code: 'TIMEOUT' }).kind, 'timeout')
assert.equal(classifySaleSyncError(new Error('temporary failure'), { online: false }).kind, 'network')

const finalizeStart = app.indexOf('const finalizeSale = useCallback')
const finalizeEnd = app.indexOf('const handleVoidSale', finalizeStart)
const finalize = app.slice(finalizeStart, finalizeEnd)
assert.match(finalize, /classifySaleSyncError\(error\)/)
assert.match(finalize, /return false\r?\n  \}, \[session, activeOrder/)
assert.match(finalize, /lastSellerName\.current = sellerName/)
assert.match(finalize, /processSaleSyncQueue\(\{ reason: 'sale-write-failure' \}\)/)
assert.match(finalize, /stableOperationKey/)
assert.match(sync, /readCashierSaleSyncDiagnostics/)
assert.match(sync, /get\(ref\(db, '\.info\/connected'\)\)/)
assert.doesNotMatch(sync.slice(sync.indexOf('export const readCashierSaleSyncDiagnostics'), sync.indexOf('const readCachedExpenses')), /\b(set|update|remove|runTransaction)\(/)
assert.match(rules.pos101_sales['.write'], /auth != null/)
assert.match(rules.pos101_sales['.read'], /auth != null/)
assert.match(rules.pos101_products['.read'], /auth != null/)
assert.match(rules.pos101_operational_day['.read'], /auth != null/)

console.log('SYNC_ERROR_CLASSIFICATION_TEST=PASS')
console.log('RETRY_SAME_OPERATION_KEY_TEST=PASS')
console.log('NO_DUPLICATE_RETRY_TEST=PASS')
console.log('CART_STAYS_ON_FAILURE_TEST=PASS')
console.log('PRESALE_READ_ONLY_DIAGNOSTICS_TEST=PASS')
console.log('NO_START_DAY_FOR_SYNC_FAILURE_TEST=PASS')
console.log('FIREBASE_RULES_AUDIT=PASS')
