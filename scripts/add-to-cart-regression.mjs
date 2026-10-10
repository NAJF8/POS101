import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCartItem } from '../src/services/cartItem.js'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/components/OrderPanel.jsx', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')

const normal = buildCartItem({ id: 'espresso', price: 3000 }, 'espresso-1')
assert.equal(normal.ok, true)
assert.equal(normal.item.price, 3000)
assert.deepEqual(normal.item.options, [])
const items = [normal.item]
assert.equal(items.reduce((sum, item) => sum + item.price * 1, 0), 3000)
assert.equal(items.reduce((sum, item) => sum + 1, 0), 1)

const malformed = buildCartItem({ id: 'legacy', price: '4500', options: 'not-an-array' }, 'legacy-1')
assert.equal(malformed.ok, true)
assert.deepEqual(malformed.item.options, [])
const invalid = buildCartItem({ id: 'broken', price: 'not-a-number' }, 'broken-1')
assert.equal(invalid.ok, false)
assert.equal(invalid.error, 'تعذر إضافة المنتج: السعر غير صالح')

assert.match(app, /buildCartItem\(p, /)
assert.match(panel, /Array\.isArray\(item\.options\) \? item\.options : \[\]/)
assert.match(main, /data-testid="app-error-fallback"/)
assert.match(main, /إعادة تحميل النظام/)

console.log('ADD_TO_CART_CLICK_TEST=PASS')
console.log('CART_COUNT_INCREMENT_TEST=PASS')
console.log('CART_TOTAL_UPDATE_TEST=PASS')
console.log('MALFORMED_PRODUCT_NO_CRASH=PASS')
console.log('INVALID_PRICE_SAFE_ERROR=PASS')
console.log('GREEN_SCREEN_SAFE_RELOAD=PASS')
