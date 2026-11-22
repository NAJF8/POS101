import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPinSalt, hashCashierPin, verifyCashierPin } from '../src/services/cashierPin.js'
import {
  COMPLETED_ORDER_EDIT_FORBIDDEN_MESSAGE,
  COMPLETED_ORDER_EDIT_PIN_INVALID_MESSAGE,
  EDIT_COMPLETED_ORDER,
  anyStaffCanEditCompletedOrders,
  authorizeCompletedOrderEdit,
  buildSaleEditPatch,
  buildSaleItemCorrectionPatch,
  completedOrderEditCandidates,
  saleCorrectionChangedFields,
  saleEditPreservesIdentity,
  staffHasPermission,
} from '../src/services/saleEdit.js'

const results = {}
const pass = key => { results[key] = 'PASS' }

// ── Staff fixtures: PINs are stored exactly like saveCashierPin does (salted SHA-256).
const withPin = async (row, pin) => { const pinSalt = createPinSalt(); return { ...row, pinEnabled: true, pinSalt, pinHash: await hashCashierPin(pin, pinSalt) } }
const rafid = await withPin({ id: 'staff-rafid', name: 'د. رافد', code: '101', role: 'manager', active: true, permissions: { [EDIT_COMPLETED_ORDER]: true } }, '4821')
const ali = await withPin({ id: 'staff-ali', name: 'علي', code: '102', role: 'cashier', active: true, permissions: { [EDIT_COMPLETED_ORDER]: true } }, '7310')
const hussein = await withPin({ id: 'staff-hussein', name: 'حسين', code: '103', role: 'cashier', active: true }, '5555')
const otherManager = await withPin({ id: 'staff-manager', name: 'مدير آخر', code: '104', role: 'manager', active: true, permissions: { [EDIT_COMPLETED_ORDER]: false } }, '9090')
const sameNameAli = await withPin({ id: 'staff-ali-2', name: 'علي', code: '105', role: 'employee', active: true }, '1212')
const inactiveWithPermission = await withPin({ id: 'staff-old', name: 'سابق', code: '106', role: 'employee', active: false, permissions: { [EDIT_COMPLETED_ORDER]: true } }, '3333')
const noPinWithPermission = { id: 'staff-nopin', name: 'بدون رمز', code: '107', role: 'employee', active: true, pinEnabled: false, permissions: { [EDIT_COMPLETED_ORDER]: true } }
const staff = [rafid, ali, hussein, otherManager, sameNameAli, inactiveWithPermission, noPinWithPermission]
const staffSnapshotBefore = JSON.stringify(staff)

const authorize = (staffId, pin) => authorizeCompletedOrderEdit({ staffId, pin, staff })

// ── د. رافد
const rafidOk = await authorize('staff-rafid', '4821')
assert.deepEqual(rafidOk, { ok: true, staffId: 'staff-rafid', name: 'د. رافد', role: 'manager' }); pass('RAFID_CORRECT_PIN_ALLOWED')
const rafidBad = await authorize('staff-rafid', '0000')
assert.equal(rafidBad.ok, false); assert.equal(rafidBad.code, 'COMPLETED_ORDER_EDIT_PIN_INVALID'); assert.equal(rafidBad.message, COMPLETED_ORDER_EDIT_PIN_INVALID_MESSAGE); pass('RAFID_WRONG_PIN_REJECTED')

// ── علي
const aliOk = await authorize('staff-ali', '7310')
assert.equal(aliOk.ok, true); assert.equal(aliOk.staffId, 'staff-ali'); pass('ALI_CORRECT_PIN_ALLOWED')
const aliBad = await authorize('staff-ali', '7311')
assert.equal(aliBad.ok, false); assert.equal(aliBad.code, 'COMPLETED_ORDER_EDIT_PIN_INVALID'); pass('ALI_WRONG_PIN_REJECTED')
// Ali's PIN must not authorize as another staff id (PIN is bound to the selected id).
assert.equal((await authorize('staff-rafid', '7310')).code, 'COMPLETED_ORDER_EDIT_PIN_INVALID'); pass('PIN_BOUND_TO_SELECTED_STAFF_ID')

// ── موظف آخر
const husseinCorrect = await authorize('staff-hussein', '5555')
assert.equal(husseinCorrect.ok, false)
assert.equal(husseinCorrect.code, 'COMPLETED_ORDER_EDIT_FORBIDDEN')
assert.equal(husseinCorrect.message, COMPLETED_ORDER_EDIT_FORBIDDEN_MESSAGE)
assert.equal(husseinCorrect.message, 'ليس لديك صلاحية لتعديل الطلب بعد البيع.')
assert.notEqual(husseinCorrect.message, COMPLETED_ORDER_EDIT_PIN_INVALID_MESSAGE)
assert.doesNotMatch(husseinCorrect.message, /غير صحيح|غلط/); pass('OTHER_CORRECT_PIN_FORBIDDEN_WITH_PERMISSION_MESSAGE')
const husseinWrong = await authorize('staff-hussein', '1111')
assert.equal(husseinWrong.code, 'COMPLETED_ORDER_EDIT_PIN_INVALID'); assert.equal(husseinWrong.message, COMPLETED_ORDER_EDIT_PIN_INVALID_MESSAGE); pass('OTHER_WRONG_PIN_REJECTED_AS_WRONG_PIN')
assert.equal((await authorize('staff-manager', '9090')).code, 'COMPLETED_ORDER_EDIT_FORBIDDEN'); pass('MANAGER_ROLE_DOES_NOT_IMPLY_PERMISSION')
assert.equal((await authorize('staff-ali-2', '1212')).code, 'COMPLETED_ORDER_EDIT_FORBIDDEN'); pass('SAME_NAME_DIFFERENT_ID_FORBIDDEN')
assert.equal((await authorize('staff-old', '3333')).ok, false); pass('INACTIVE_STAFF_FORBIDDEN')
assert.equal((await authorize('staff-nopin', '')).ok, false); pass('STAFF_WITHOUT_EXISTING_PIN_CANNOT_EDIT')
assert.equal((await authorize('', '4821')).ok, false); assert.equal((await authorize('ghost', '4821')).ok, false); pass('UNKNOWN_STAFF_REJECTED')

// Only active PIN holders are offered; permission is never granted implicitly.
assert.deepEqual(completedOrderEditCandidates(staff).map(row => row.id), ['staff-rafid', 'staff-ali', 'staff-hussein', 'staff-manager', 'staff-ali-2'])
assert.deepEqual(staff.filter(row => staffHasPermission(row, EDIT_COMPLETED_ORDER) && row.pinEnabled).map(row => row.id), ['staff-rafid', 'staff-ali'])
assert.equal(anyStaffCanEditCompletedOrders([hussein, otherManager]), false)
assert.equal(anyStaffCanEditCompletedOrders(staff), true); pass('ONLY_EXPLICITLY_GRANTED_STAFF_HAVE_PERMISSION')

// Existing PIN verification is unchanged and PIN records are never mutated.
assert.equal(await verifyCashierPin('4821', rafid), true)
assert.equal(await verifyCashierPin('5555', hussein), true)
assert.equal(JSON.stringify(staff), staffSnapshotBefore); pass('EXISTING_PINS_UNCHANGED')

// ── Orders
const completed = { id: 's-1', saleId: 's-1', operationKey: 'pos101:s-1', orderNumber: 41, businessDate: '2026-11-22', operationalDayId: 'day-22', status: 'completed', paymentMethod: 'cash', subtotal: 17000, discount: 1000, total: 16000, items: [
  { id: 'latte', name: 'لاتيه', quantity: 2, price: 4000 },
  { id: 'cake', name: 'كيك', quantity: 1, price: 6000 },
  { id: 'water', name: 'ماء', quantity: 3, price: 1000 },
] }
const editAuthorization = { staffId: 'staff-rafid', pin: '4821' }

// metadata edit (discount / payment) on a completed order
const metaPatch = buildSaleEditPatch(completed, { discount: 2000, paymentMethod: 'electronic', reason: 'تصحيح', editAuthorization })
const afterMeta = { ...completed, ...metaPatch }
assert.equal(afterMeta.total, 15000); assert.equal(afterMeta.paymentMethod, 'electronic'); assert.equal(saleEditPreservesIdentity(completed, afterMeta), true)
assert.equal(JSON.stringify(metaPatch).includes('4821'), false); pass('COMPLETED_ORDER_METADATA_EDIT_SAVES')

// change quantity + delete product, multiple products
const corrected = buildSaleItemCorrectionPatch(completed, { discount: 1000, editAuthorization, items: [
  { _originalIndex: 0, quantity: 3, unitPrice: 4000 },
  { _originalIndex: 2, quantity: 3, unitPrice: 1000 },
] })
assert.deepEqual(corrected.items.map(item => [item.id, item.quantity, item.price]), [['latte', 3, 4000], ['water', 3, 1000]])
assert.equal(corrected.subtotal, 15000); assert.equal(corrected.total, 14000)
assert.equal(JSON.stringify(corrected).includes('4821'), false)
const afterCorrection = { ...completed, ...corrected }
assert.equal(saleEditPreservesIdentity({ ...completed, items: undefined }, { ...afterCorrection, items: undefined }), true)
assert.ok(saleCorrectionChangedFields(completed, afterCorrection).items); pass('QUANTITY_CHANGE_AND_PRODUCT_DELETE_SAVE')

// order that was already edited before can be edited again without losing identity
const secondEdit = { ...afterCorrection, ...buildSaleItemCorrectionPatch(afterCorrection, { discount: 0, items: [{ _originalIndex: 0, quantity: 1, unitPrice: 4000 }, { _originalIndex: 1, quantity: 3, unitPrice: 1000 }] }) }
assert.equal(secondEdit.total, 7000); assert.equal(secondEdit.orderNumber, 41); assert.equal(secondEdit.saleId, 's-1'); pass('PREVIOUSLY_EDITED_ORDER_EDITS_AGAIN')
assert.throws(() => buildSaleItemCorrectionPatch(completed, { items: [] }), /لا يمكن حذف جميع المنتجات/); pass('CANNOT_DELETE_ALL_PRODUCTS')

// ── Service layer enforcement (the code path that writes the sale)
const service = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const body = name => { const start = service.indexOf(`export const ${name} = async`); return service.slice(start, service.indexOf('\n}\n', start)) }
for (const name of ['updateCentralSale', 'correctCentralSaleItems']) {
  const fn = body(name)
  const gate = fn.indexOf('await requireCompletedOrderEditor(changes.editAuthorization)')
  assert.ok(gate > 0, `${name} must enforce EDIT_COMPLETED_ORDER`)
  assert.ok(gate < fn.indexOf('await get(saleRef)') && gate < fn.indexOf('await update(ref(db)'), `${name} must authorize before reading/writing`)
  assert.match(fn, /editedByStaffId: editor\.staffId/)
  assert.match(fn, /permission: EDIT_COMPLETED_ORDER/)
  assert.doesNotMatch(fn, /editAuthorization\.pin|changes\.editAuthorization\b(?!\))/)
}
assert.match(service, /const requireCompletedOrderEditor = async authorization => \{\n  const result = await authorizeCompletedOrderEdit\(\{ staffId: authorization\?\.staffId, pin: authorization\?\.pin, staff: await readCentralStaff\(\) \}\)/)
assert.doesNotMatch(service, /validateCorrectionIdentity/)
pass('SERVICE_LAYER_REVERIFIES_PIN_AND_PERMISSION'); pass('PIN_NEVER_PERSISTED')
// staff saves keep existing PIN fields from the stored record
assert.match(service, /pinEnabled: existing\?\.pinEnabled === true, pinHash: existing\?\.pinHash \|\| null, pinSalt: existing\?\.pinSalt \|\| null/); pass('STAFF_SAVE_PRESERVES_PINS')

// ── UI flow
const ui = fs.readFileSync(new URL('../src/components/OrderHistoryMenu.jsx', import.meta.url), 'utf8')
assert.match(ui, /authorizeCompletedOrderEdit\(\{ staffId: authForm\.staffId, pin: authForm\.pin, staff \}\)/)
assert.match(ui, /editAuthorization \}/)
assert.match(ui, /disabled=\{!onEditSale \|\| !editPermissionAvailable \|\| sale\.status === 'voided'\}/)
assert.doesNotMatch(ui, /validateCorrectionIdentity|correctionIdentity|row\.code/)
pass('UI_PIN_THEN_PERMISSION_BEFORE_EDIT')

// ── Database rules server-side enforcement
const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules
const saleValidate = rules.pos101_sales?.$saleId?.['.validate'] || ''
assert.match(saleValidate, /!data\.exists\(\)/)
assert.match(saleValidate, /lastEditedByStaffId/)
assert.match(saleValidate, /pos101_staff/)
assert.match(saleValidate, /EDIT_COMPLETED_ORDER/)
pass('RTDB_RULES_ENFORCE_EDIT_COMPLETED_ORDER')

// ── Normal selling paths untouched by this permission
for (const path of ['../src/services/saleEngine.js', '../src/services/cartPipeline.js', '../src/components/OrderPanel.jsx', '../src/services/salesSyncQueue.js']) {
  assert.doesNotMatch(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), /EDIT_COMPLETED_ORDER|requireCompletedOrderEditor/)
}
pass('NEW_ORDER_BEFORE_SALE_UNAFFECTED')

console.log(JSON.stringify(results, null, 2))
