import assert from 'node:assert/strict'
import { buildSaleEditPatch, saleEditPreservesIdentity, saleEditableSnapshot } from '../src/services/saleEdit.js'

const before = { id: 's1', saleId: 's1', operationKey: 'pos101:s1', orderNumber: 7, businessDate: '2026-10-08', operationalDayId: 'day1', subtotal: 10000, discount: 0, total: 10000, items: [{ id: 'coffee', quantity: 1 }], orderType: 'داخل الكوفي', note: 'old' }
const after = { ...before, ...buildSaleEditPatch(before, { orderType: 'بلي', paymentMethod: 'electronic', discount: 2600, note: 'edited', reason: 'تصحيح المصدر' }) }
assert.equal(after.total, 7400)
assert.equal(after.orderType, 'بلي')
assert.equal(after.note, 'edited')
assert.equal(saleEditPreservesIdentity(before, after), true)
assert.equal(saleEditableSnapshot(after).discount, 2600)
console.log('SALE_EDIT_REGRESSION=PASS')
