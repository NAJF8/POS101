import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCartItem, getAdditionLabel, getOptionLabel, getSizeLabel, normalizeCartItem, normalizeCartItems, normalizeOrder, safeFormatMoney } from '../src/services/cartItem.js'
import { simulateCashierFlow } from '../src/services/safeSystemCheck.js'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/components/OrderPanel.jsx', import.meta.url), 'utf8')
const dialogs = fs.readFileSync(new URL('../src/components/Dialogs.jsx', import.meta.url), 'utf8')
const history = fs.readFileSync(new URL('../src/components/OrderHistoryMenu.jsx', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')

const optionsItem = buildCartItem({
  id: 'flavored-latte',
  name: 'ايس لاتيه بنكهات',
  price: 5500,
  quantity: 1,
  size: { id: 'regular', label: 'عادي', priceDelta: 0 },
  options: [{ name: 'عادي' }, { label: { unexpected: true }, id: 'vanilla', price: 500 }],
  additions: [{ name_ar: 'فانيلا', price: 500 }],
  selectedOptions: { broken: true },
}, 'flavored-latte-1')

assert.equal(optionsItem.ok, true)
assert.equal(typeof optionsItem.item.id, 'string')
assert.equal(typeof optionsItem.item.cartItemId, 'string')
assert.equal(optionsItem.item.displayName, 'ايس لاتيه بنكهات')
assert.equal(getSizeLabel(optionsItem.item.size), 'عادي')
assert.deepEqual(optionsItem.item.options.map(getOptionLabel), ['عادي', 'vanilla'])
assert.deepEqual(optionsItem.item.additions.map(getAdditionLabel), ['فانيلا'])
assert.equal(Number.isFinite(optionsItem.item.total), true)
assert.equal(Array.isArray(optionsItem.item.options), true)
assert.equal(Array.isArray(optionsItem.item.additions), true)
assert.equal(Array.isArray(optionsItem.item.selectedOptions), true)
assert.equal(safeFormatMoney({ bad: true }).includes('NaN'), false)

const malformed = normalizeCartItem({ id: 'legacy', name: 'منتج قديم', price: 'bad', quantity: 'bad', options: { bad: true }, additions: 'bad' }, 'legacy-1')
assert.equal(malformed.price, 0)
assert.equal(malformed.quantity, 1)
assert.equal(malformed.displayName, 'منتج قديم')
assert.deepEqual(malformed.options, [])
assert.deepEqual(malformed.additions, [])
assert.equal(normalizeCartItems([{ id: 'same' }, { id: 'same' }])[0].lineId === normalizeCartItems([{ id: 'same' }, { id: 'same' }])[1].lineId, false)
assert.deepEqual(normalizeOrder({ items: { broken: true } }).items, [])

const products = [{ id: 'normal', name: 'قهوة', price: 4000 }, { id: 'options', name: 'ايس لاتيه بنكهات', price: 5500, configurable: true }]
const baseOrder = { id: 'dry-run', items: [] }
const build = (product, lineId) => buildCartItem({ ...product, quantity: 1, size: lineId.includes('options') ? 'عادي' : null, options: lineId.includes('options') ? ['عادي'] : [], additions: [] }, lineId)
const normalize = normalizeOrder
const totals = order => ({ total: normalizeCartItems(order.items).reduce((sum, item) => sum + item.total, 0) })
const flow = simulateCashierFlow({ products, activeOrder: baseOrder, buildCartItemFn: build, normalizeOrderFn: normalize, calculateTotalsFn: totals, paymentSummaryFn: value => ({ total: value.total, label: safeFormatMoney(value.total) }) })
assert.equal(flow.status, 'pass')
assert.equal(flow.optionsProductDryAdd, 'PASS')
assert.equal(flow.totalsCalculable, 'YES')
assert.equal(flow.paymentSummaryReady, 'YES')
assert.deepEqual(baseOrder, { id: 'dry-run', items: [] })

assert.match(app, /localStorage\.setItem\('pos101\.orders', JSON\.stringify\(orders\.map\(normalizeOrder\)\)/)
assert.match(app, /__POS101_LAST_CART_ITEM_SUMMARY__/)
assert.match(dialogs, /size: \{ id: `size-\$\{size\}`/)
assert.match(panel, /getSizeLabel\(item\.size\)/)
assert.match(panel, /getAdditionLabel/)
assert.match(history, /normalizeCartItems\(sale\.items \|\| sale\.order\?\.items\)/)
assert.match(main, /نسخ التقرير/)
assert.match(main, /lastAction/)

console.log('NORMAL_PRODUCT_ADD_TEST=PASS')
console.log('OPTIONS_PRODUCT_ADD_TEST=PASS')
console.log('CART_RENDER_OBJECT_SAFE_TEST=PASS')
console.log('INVALID_PRICE_SAFE_TEST=PASS')
console.log('NORMALIZE_ORDER_TEST=PASS')
console.log('PAYMENT_SUMMARY_SAFE_TEST=PASS')
console.log('SAFE_CHECK_OPTIONS_CRASH_TEST=PASS')
console.log('SAFE_CHECK_NO_FALSE_OK_TEST=PASS')
console.log('SAFE_CHECK_NO_MUTATION_TEST=PASS')
console.log('ERROR_BOUNDARY_REPORT_TEST=PASS')
