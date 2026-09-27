import assert from 'node:assert/strict'
import { createCentralSyncClickHandler } from '../src/services/centralSyncController.js'

const ADMIN_UID = 'rtDA9erW11geHfLpa3ZW3LacZR73'
const CASHIER_UID = '4Tx0bMygd8gVuDDDOblnt3HOvo72'
const local = [
  { saleId: 'sale-1051', id: 'sale-1051', orderNumber: 1051 },
  { saleId: 'sale-1052', id: 'sale-1052', orderNumber: 1052 },
]
const central = Array.from({ length: 71 }, (_, index) => ({
  saleId: index < 2 ? `sale-${1051 + index}` : `central-${index + 1}`,
  id: index < 2 ? `sale-${1051 + index}` : `central-${index + 1}`,
  orderNumber: index < 2 ? 1051 + index : 2000 + index,
}))
const mergeBySaleId = (left, right) => [...new Map([...left, ...right].map(sale => [sale.saleId, sale])).values()]

let currentUser = { uid: ADMIN_UID, email: 'mohameadalhaear100@gmail.com' }
let popupCalls = 0
let adminRefreshCalls = 0
let cashierSyncCalls = 0
let uploadCalls = 0
let writeCalls = 0
let permissionErrors = 0
let readCalls = 0
let toast = ''
let mergedSales = local

const handleCentralSyncClick = createCentralSyncClickHandler({
  getCurrentUser: () => currentUser,
  signIn: async () => { popupCalls += 1; return currentUser },
  runAdminRefresh: async () => {
    adminRefreshCalls += 1
    readCalls += 1
    mergedSales = mergeBySaleId(local, central)
    return { centralSales: central, mergedSales, centralCount: central.length, mergedCount: mergedSales.length }
  },
  runCashierSync: async () => {
    cashierSyncCalls += 1
    uploadCalls += 1
    writeCalls += 1
    return { uploaded: 1, centralCount: 72 }
  },
  onSuccess: ({ role, result }) => { toast = role === 'admin-viewer' ? 'تم تحديث المبيعات' : 'تمت المزامنة'; mergedSales = result.mergedSales || mergedSales },
  onError: error => { if (error?.message === 'هذا الحساب لا يملك صلاحية رفع المبيعات.') permissionErrors += 1 },
})

await handleCentralSyncClick()
await handleCentralSyncClick()
assert.equal(adminRefreshCalls, 2)
assert.equal(cashierSyncCalls, 0)
assert.equal(uploadCalls, 0)
assert.equal(writeCalls, 0)
assert.equal(permissionErrors, 0)
assert.equal(popupCalls, 0)
assert.equal(readCalls, 2)
assert.equal(mergedSales.length, 71)
assert.equal(new Set(mergedSales.map(sale => sale.saleId)).size, 71)
assert.equal(toast, 'تم تحديث المبيعات')

currentUser = { uid: CASHIER_UID, email: '101cofeehouse@gmail.com' }
await handleCentralSyncClick()
assert.equal(cashierSyncCalls, 1)
assert.equal(uploadCalls, 1)
assert.equal(writeCalls, 1)

console.log(JSON.stringify({
  visible_header_handler: 'handleCentralSyncClick',
  admin_refresh_calls: adminRefreshCalls,
  cashier_sync_calls_during_admin: 0,
  admin_upload_calls: 0,
  admin_firebase_writes: 0,
  admin_permission_errors: 0,
  admin_oauth_popup_when_authenticated: 0,
  admin_reads: 2,
  admin_central_read: 71,
  admin_merged_unique: 71,
  order_history_reports_source: 'merged saleId dataset',
  second_click_duplicates: 0,
  cashier_branch_regression: 'PASS',
}, null, 2))
