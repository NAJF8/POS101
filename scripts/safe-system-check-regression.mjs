import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const service = await import('../src/services/safeSystemCheck.js')

assert.equal(service.safeJsonParse('{bad', 'fallback'), 'fallback')
assert.equal(service.safeText('  ok  '), 'ok')
assert.equal(service.safeNumber('bad', 7), 7)
assert.match(service.safeFormatMoney(1200), /1,?200|١٬٢٠٠/)
assert.match(service.safeErrorMessage({ code: 'TEST', message: `bearer ${'x'.repeat(60)}` }), /redacted/)
assert.deepEqual(service.safeObjectSummary([1, 2]), { type: 'array', length: 2 })

const products = [{ id: 'normal', name: 'قهوة مقطرة', price: 7000 }, { id: 'options', name: 'ايس لاتيه بنكهات', price: 5500, configurable: true }]
const baseOrder = { id: 1, items: [] }
const build = (product, lineId) => ({ ok: true, item: { ...product, lineId, productId: product.id, quantity: 1, price: Number(product.unitPrice ?? product.price), options: product.options || [], additions: product.additions || [] } })
const normalize = order => ({ ...order, items: Array.isArray(order.items) ? order.items.map(item => ({ ...item, options: Array.isArray(item.options) ? item.options : [] })) : [] })
const totals = order => ({ subtotal: order.items.reduce((sum, item) => sum + item.price * item.quantity, 0), discount: 0, total: order.items.reduce((sum, item) => sum + item.price * item.quantity, 0) })
const runFlow = overrides => service.simulateCashierFlow({ products, activeOrder: baseOrder, buildCartItemFn: build, normalizeOrderFn: normalize, calculateTotalsFn: totals, paymentSummaryFn: value => ({ total: value.total, label: `${value.total} د.ع` }), ...overrides })
assert.equal(runFlow().realFlowCheck, 'PASS')
assert.equal(runFlow({ buildCartItemFn: () => { throw new Error('NORMAL_ADD_BROKEN') } }).status, 'fail')
assert.equal(runFlow({ buildCartItemFn: (product, lineId) => { if (lineId.includes('options')) throw new Error('OPTIONS_ADD_BROKEN'); return build(product, lineId) } }).status, 'fail')
assert.equal(runFlow({ calculateTotalsFn: () => { throw new Error('TOTALS_BROKEN') } }).status, 'fail')
assert.equal(runFlow({ paymentSummaryFn: () => null }).status, 'fail')
assert.deepEqual(baseOrder, { id: 1, items: [] })

const checks = await service.runIndependentChecks([
  ['pass', async () => ({ status: 'pass', message: 'ok' })],
  ['malformed-json', async () => { service.safeJsonParse('{bad'); return { status: 'warn', message: 'handled' } }],
  ['firebase-read-failure', async () => { throw Object.assign(new Error('permission denied'), { code: 'PERMISSION_DENIED' }) }],
  ['after-failure', async () => ({ status: 'pass', message: 'continued' })],
])
assert.equal(checks.length, 4)
assert.equal(checks[2].status, 'fail')
assert.equal(checks[3].status, 'pass')

const app = read('src/App.jsx')
const header = read('src/components/Header.jsx')
const serviceSource = read('src/services/safeSystemCheck.js')
const component = read('src/components/SafeSystemCheck.jsx')
assert.match(app, /runSafeSystemCheck/)
assert.match(header, /فحص وإصلاح النظام|SafeSystemCheck/)
assert.match(component, /data-testid="safe-system-check-button"/)
assert.match(serviceSource, /readCentralExpensesForReports\(\{ persistCache: false, dispatchUpdate: false \}\)/)
for (const forbidden of ['markSaleSynced', 'saveCentralSaleImmediately', 'enqueueSale', 'removeItem', 'localStorage.clear']) assert.equal(serviceSource.includes(forbidden), false, `safe service contains forbidden write: ${forbidden}`)
assert.match(serviceSource, /firebaseWrites: 0/)
assert.match(serviceSource, /REAL_CASHIER_FLOW_SIMULATION|real-cashier-flow-simulation/)
assert.match(serviceSource, /simulateCashierFlow/)
assert.match(component, /safe-test-cart-flow/)
assert.match(component, /يوجد خلل في مسار الكاشير/)
console.log('SAFE_SYSTEM_CHECK_REGRESSION=PASS')
console.log('SAFE_CHECK_REAL_FLOW_FAIL_TEST=PASS')
console.log('SAFE_CHECK_OPTIONS_FLOW_FAIL_TEST=PASS')
console.log('SAFE_CHECK_TOTALS_FAIL_TEST=PASS')
console.log('SAFE_CHECK_NO_FALSE_OK_TEST=PASS')
console.log('SAFE_CHECK_NO_MUTATION_TEST=PASS')
console.log('COPY_REPORT_REAL_FLOW_TEST=PASS')
