import assert from 'node:assert/strict'
import { buildSaleEditPatch, buildSaleItemCorrectionPatch, maskCorrectionCode, saleCorrectionChangedFields, saleEditPreservesIdentity, saleEditableSnapshot, validateCorrectionIdentity } from '../src/services/saleEdit.js'

const before = { id: 's1', saleId: 's1', operationKey: 'pos101:s1', orderNumber: 7, businessDate: '2026-10-08', operationalDayId: 'day1', subtotal: 10000, discount: 0, total: 10000, items: [{ id: 'coffee', quantity: 1 }], orderType: 'داخل الكوفي', note: 'old' }
const after = { ...before, ...buildSaleEditPatch(before, { orderType: 'بلي', paymentMethod: 'electronic', discount: 2600, note: 'edited', reason: 'تصحيح المصدر' }) }
assert.equal(after.total, 7400)
assert.equal(after.orderType, 'بلي')
assert.equal(after.note, 'edited')
assert.equal(saleEditPreservesIdentity(before, after), true)
assert.equal(saleEditableSnapshot(after).discount, 2600)

const correctionBefore = { ...before, subtotal: 15000, total: 14500, discount: 500, paymentMethod: 'cash', items: [{ id: 'coffee', name: 'قهوة', quantity: 2, price: 5000 }, { id: 'cake', name: 'كيك', quantity: 1, price: 5000 }] }
const correction = buildSaleItemCorrectionPatch(correctionBefore, { items: [{ ...correctionBefore.items[0], _originalIndex: 0, quantity: 3, unitPrice: 4500 }], discount: 500 })
assert.equal(correction.items.length, 1)
assert.equal(correction.items[0].quantity, 3)
assert.equal(correction.items[0].price, 4500)
assert.equal(correction.subtotal, 13500)
assert.equal(correction.total, 13000)
assert.equal(saleCorrectionChangedFields(correctionBefore, { ...correctionBefore, ...correction }).items.before.length, 2)
assert.throws(() => buildSaleItemCorrectionPatch(correctionBefore, { items: [], discount: 0 }), /لا يمكن حذف جميع المنتجات/)
assert.throws(() => buildSaleItemCorrectionPatch(correctionBefore, { items: [{ ...correctionBefore.items[0], _originalIndex: 0, quantity: 0, unitPrice: 1 }], discount: 0 }), /الكمية/)
assert.throws(() => buildSaleItemCorrectionPatch(correctionBefore, { items: [{ ...correctionBefore.items[0], _originalIndex: 0, quantity: 1, unitPrice: -1 }], discount: 0 }), /السعر/)
const manager = { id: 'manager-1', name: 'مدير الاختبار', code: 'M1296', role: 'manager', active: true }
assert.equal(validateCorrectionIdentity({ name: manager.name, code: manager.code, staff: [manager], requireAdmin: true }).valid, true)
assert.equal(validateCorrectionIdentity({ name: manager.name, code: 'wrong', staff: [manager], requireAdmin: true }).valid, false)
assert.equal(validateCorrectionIdentity({ name: 'كاشير', code: 'C100', staff: [{ name: 'كاشير', code: 'C100', role: 'cashier', active: true }], requireAdmin: true }).valid, false)
assert.equal(maskCorrectionCode('M1296'), '***296')
assert.equal(maskCorrectionCode('M1296').includes('M1296'), false)
console.log('SALE_EDIT_REGRESSION=PASS')
