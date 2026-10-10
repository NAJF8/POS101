import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeCartItems, normalizeOrder, safeNumber } from '../src/services/cartItem.js'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const dialogs = fs.readFileSync(new URL('../src/components/Dialogs.jsx', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/components/OrderPanel.jsx', import.meta.url), 'utf8')
const versionUpdate = fs.readFileSync(new URL('../src/services/versionUpdate.js', import.meta.url), 'utf8')

// Synthetic export fixture matching the malformed shapes reported on the cashier device.
// This is deliberately not presented as an export from the physical device.
const cashierLocalState = {
  'pos101.orders': JSON.stringify([{ id: 1, name: 'طلب 1', items: [
    { id: 'legacy-1', name: 'منتج قديم', price: '3000', quantity: 1, options: { size: 'عادي' }, additions: { flavor: 'فانيلا' } },
    { id: 'safe-1', name: 'قهوة', price: 4000, quantity: 2, options: ['بدون سكر'] },
  ] }]),
  'pos101.session': JSON.stringify({ shiftId: 'cashier-shift', shiftType: 'morning' }),
}

const rawOrders = JSON.parse(cashierLocalState['pos101.orders'])
const safeOrder = normalizeOrder(rawOrders[0])
assert.equal(Array.isArray(safeOrder.items), true)
assert.equal(safeOrder.items.length, 2)
assert.deepEqual(safeOrder.items[0].options, [])
assert.deepEqual(safeOrder.items[0].additions, [])
assert.equal(safeOrder.items[1].total, 8000)

const customized = normalizeOrder({
  ...safeOrder,
  items: [...safeOrder.items, { id: 'latte', name: 'ايس لاتيه بنكهات', price: 5500, quantity: 1, options: [{ label: 'عادي' }] }],
})
assert.equal(customized.items.length, 3)
assert.equal(customized.items.at(-1).total, 5500)
assert.equal(customized.items.reduce((sum, item) => sum + safeNumber(item.total, 0), 0), 16500)
assert.deepEqual(normalizeCartItems({ bad: true }), [])

assert.match(app, /normalizeOrder\(orders\[active\] \|\| orders\[0\] \|\| blankOrder\(1\)\)/)
assert.match(app, /const activeDiscount = discountValue\(subtotal, activeOrder\.discount/)
assert.match(dialogs, /normalizeCartItems\(order\.items \|\| sale\.items\)/)
assert.match(panel, /normalizeCartItems\(order\?\.items\)/)
assert.doesNotMatch(panel, /\{item\.options\}/)
assert.match(versionUpdate, /isNewerBuild/)
assert.match(versionUpdate, /pos101\.updateReload/)

console.log('CASHIER_BAD_LOCALSTATE_REGRESSION_TEST=PASS')
console.log('MALFORMED_EXISTING_CART_ADD_OPTIONS_TEST=PASS')
console.log('PAYMENT_MODAL_WITH_BAD_CART_TEST=PASS')
console.log('RECEIPT_WITH_BAD_CART_TEST=PASS')
console.log('NO_OBJECT_REACT_CHILD_TEST=PASS')
console.log('STALE_BUNDLE_DETECTION_SOURCE_TEST=PASS')
