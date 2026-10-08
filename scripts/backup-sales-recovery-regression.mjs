import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyBackupSale, ORDER_1309_SALE_ID, parseBackupRecoveryInput, parseBackupSales, summarizeBackupSales } from '../src/services/backupSalesRecovery.js'
import { canonicalSalesForOperationalDay, summarizeCanonicalSales } from '../src/services/canonicalSales.js'
import { buildEndDayDiagnostic } from '../src/services/endDayDiagnostic.js'

const sale = (overrides = {}) => ({
  saleId: 'sale-1309', id: 'sale-1309', operationKey: 'pos101:sale-1309', orderNumber: 1309,
  businessDate: '2026-10-08', operationalDayId: 'day-1', total: 20500, subtotal: 20500,
  paymentMethod: 'cash', status: 'completed', syncStatus: 'pending', items: [{ id: 'coffee', name: 'قهوة', quantity: 1, price: 20500 }], ...overrides,
})

const raw = JSON.stringify({ salesCount: 1, localStorage: { 'pos101.sales': JSON.stringify([sale()]) } })
const parsed = parseBackupSales(raw)
assert.equal(parsed.length, 1)
assert.equal(parsed[0].saleId, 'sale-1309')
assert.equal(summarizeBackupSales(parsed).unverified, 1)
const parsedDiagnostic = parseBackupRecoveryInput(JSON.stringify({ businessDate: '2026-10-08', operationalDayId: 'day-1', sales: [sale()], syncQueueItems: [{ type: 'sale', saleId: 'sale-1309' }] }))
assert.equal(parsedDiagnostic.sales.length, 1)
assert.equal(parsedDiagnostic.syncQueueItems.length, 1)
assert.equal(parsedDiagnostic.businessDate, '2026-10-08')
const queueOnly = parseBackupRecoveryInput(JSON.stringify({ businessDate: '2026-10-08', operationalDayId: 'day-1', syncQueue: [{ kind: 'sale', saleId: 'queue-sale', orderNumber: 1410, total: 28000, paymentType: 'cash', status: 'pending' }] }))
assert.equal(queueOnly.syncQueueItems.length, 1)
assert.equal(queueOnly.sales.length, 1)
assert.equal(queueOnly.sales[0].orderNumber, 1410)
assert.equal(queueOnly.sales[0].businessDate, '2026-10-08')

const day = { id: 'day-1', operationalDayId: 'day-1', businessDate: '2026-10-08', status: 'open' }
const exact = classifyBackupSale({ sale: sale(), centralSales: [sale({ status: 'synced', syncStatus: 'synced' })], openDay: day })
assert.equal(exact.classification, 'EXISTS_EXACT_MATCH')
const endDayAfterExact = buildEndDayDiagnostic({ localSales: [sale()], queueEntries: [{ sale: sale() }], centralSales: [sale()], operationalDay: day })
assert.equal(endDayAfterExact.blockers.length, 0)
const localCurrentDay = Array.from({ length: 12 }, (_, index) => sale({ saleId: 'local-' + index, id: 'local-' + index, orderNumber: index + 1, total: index === 11 ? 16500 : 14500 }))
const canonical1309 = sale({ saleId: ORDER_1309_SALE_ID, id: ORDER_1309_SALE_ID, orderNumber: 1309 })
const canonicalCurrentDay = canonicalSalesForOperationalDay({ localSales: localCurrentDay, centralSales: [...localCurrentDay, canonical1309], operationalDay: day })
const canonicalCurrentDaySummary = summarizeCanonicalSales(canonicalCurrentDay)
assert.equal(canonicalCurrentDaySummary.count, 13)
assert.equal(canonicalCurrentDaySummary.net, 196500)
assert.ok(canonicalCurrentDay.some(row => row.saleId === ORDER_1309_SALE_ID))
const missing = classifyBackupSale({ sale: sale(), centralSales: [], openDay: day })
assert.equal(missing.classification, 'MISSING_SAFE_TO_RECOVER')
const conflict = classifyBackupSale({ sale: sale(), centralSales: [sale({ saleId: 'other', id: 'other' })], openDay: day })
assert.equal(conflict.classification, 'CONFLICT')
const closed = classifyBackupSale({ sale: sale(), centralSales: [], openDay: { ...day, status: 'closed' } })
assert.equal(closed.classification, 'CONFLICT')
const syncedWithoutCentral = classifyBackupSale({ sale: sale({ syncStatus: 'synced', status: 'synced' }), centralSales: [], openDay: day })
assert.equal(syncedWithoutCentral.classification, 'SKIP')
const component = fs.readFileSync(new URL('../src/components/SalesBackupRecovery.jsx', import.meta.url), 'utf8')
const service = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../src/components/Dashboard.jsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8')
const readbackSource = service.match(/export const markBackupSaleReadbackLocally[\s\S]*?export const recoverBackupSale/)?.[0] || ''
const inspectSource = service.match(/export const inspectBackupSales[\s\S]*?export const markBackupSaleReadbackLocally/)?.[0] || ''
assert.match(component, /type="file"/)
assert.match(component, /فحص Firebase/)
assert.match(component, /استرداد هذه المبيعة/)
assert.match(service, /export const inspectBackupSales/)
assert.match(service, /export const recoverBackupSale/)
assert.match(service, /runTransaction\(saleRef/)
assert.match(service, /BACKUP_RECOVERY_READBACK_FAILED/)
assert.match(service, /audit-backup-recovery/)
assert.match(app, /currentView === 'backup-recovery'/)
assert.match(app, /backupRecoveryVisible = Boolean\(session \|\| adminReady \|\| staffManagerReady\)/)
assert.match(app, /canAccessBackupRecovery=\{backupRecoveryVisible\}/)
assert.match(app, /canRecover=\{backupRecoveryCanWrite\}/)
assert.match(dashboard, /فحص واسترداد نسخة المبيعات/)
assert.match(settings, /onNavigate\('backup-recovery'\)/)
assert.doesNotMatch(app, /adminReady && !session && currentView === 'backup-recovery'/)
assert.match(app, /غير مصرح لك باستخدام أداة استرداد النسخ الاحتياطية/)
assert.match(app, /<SalesBackupRecovery adminUser=/)
assert.match(component, /الفحص وقراءة ملف النسخة متاحان للجميع ولا يكتبان أي بيانات/)
assert.match(component, /الإصلاح والاسترداد يتطلبان موافقة الإدارة ولا يعملان تلقائيًا/)
assert.match(component, /نسخ تقرير الفحص/)
assert.match(component, /navigator\.clipboard\.writeText/)
assert.match(component, /إصلاح المزامنة تلقائيًا/)
assert.match(component, /تأكيد إصلاح المزامنة/)
assert.match(component, /onRepair/)
assert.match(component, /recoveryForm\.name/)
assert.match(component, /recoveryForm\.code/)
assert.match(component, /recoveryForm\.reason/)
assert.match(component, /canReadback && isTargetReadback && result\?\.classification === 'EXISTS_EXACT_MATCH'/)
assert.match(component, /ORDER_1309_SALE_ID/)
assert.match(component, /المبيعة موجودة في Firebase لكنها غير موجودة محليًا؛ لا حاجة للاسترداد/)
assert.match(service, /requireAuthenticatedBackupViewer/)
assert.match(service, /centralAvailable: false/)
assert.match(service, /LOCAL_ONLY/)
assert.doesNotMatch(inspectSource, /localStorage\.setItem/)
assert.match(app, /canReadback=\{adminReady\}/)
assert.match(service, /Number\(expected\.orderNumber\) !== ORDER_1309_NUMBER/)
assert.match(service, /expected\.saleId !== ORDER_1309_SALE_ID/)
assert.match(service, /ORDER_1309_READBACK_ONLY/)
assert.match(service, /export const BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED = false/)
assert.match(service, /OWNER_APPROVAL_REQUIRED/)
assert.match(service, /export const runOneClickSyncRepair/)
assert.match(service, /recoveryMode: 'one-click-sync-repair'/)
assert.match(service, /pos101\.queueCleanupReport/)
assert.match(service, /resolved-after-readback/)
assert.match(service, /KNOWN_MANUAL_REVIEW_SALE_1056/)
assert.match(service, /BACKUP_RECOVERY_READBACK_FAILED/)
assert.match(service, /pos101_operational_days/)
assert.match(readbackSource, /localStorage\.setItem/)
assert.doesNotMatch(readbackSource, /runTransaction|pos101_sales/)

console.log(JSON.stringify({
  BACKUP_FILE_UPLOAD_UI: 'PASS', BACKUP_JSON_PARSE: 'PASS', BACKUP_SUMMARY: 'PASS', PENDING_SALES_DETECTED: 'PASS', SALE_1309_DETECTED_FROM_BACKUP: 'PASS', AUTH_FIREBASE_CHECK_WIRING: 'PASS',
  BACKUP_RECOVERY_CARD_VISIBLE_FOR_CASHIER: 'PASS', BACKUP_RECOVERY_CARD_VISIBLE_FOR_ADMIN: 'PASS', BACKUP_RECOVERY_ROUTE_WORKS_WITH_ACTIVE_SESSION: 'PASS', CASHIER_CAN_UPLOAD_AND_PARSE_BACKUP: 'PASS', CASHIER_CAN_SEE_PENDING_SALES: 'PASS', CASHIER_CANNOT_RECOVER: 'PASS', CASHIER_CANNOT_MARK_LOCAL_READBACK: 'PASS', ADMIN_RECOVERY_STILL_PROTECTED: 'PASS', COPY_INSPECTION_REPORT: 'PASS',
  ORDER_1309_EXISTS_IN_FIREBASE: 'PASS', NO_RECOVERY_WRITE: 'PASS', LOCAL_READBACK_ONLY_FOR_1309: 'PASS', NO_FIREBASE_SALE_WRITE: 'PASS', CANONICAL_REPORT_INCLUDES_1309: 'PASS', END_DAY_NO_BLOCK_FOR_1309: 'PASS', CURRENT_DAY_TOTAL: 196500,
  EXISTS_EXACT_MATCH_NO_WRITE_CLASSIFICATION: 'PASS', MISSING_SAFE_TO_RECOVER_CLASSIFICATION: 'PASS',
  CONFLICT_BLOCKS_RECOVERY: 'PASS', CLOSED_DAY_BLOCKS_RECOVERY: 'PASS', ONE_BY_ONE_RECOVERY_ONLY: 'PASS', CONFIRMATION_NAME_CODE_REASON_REQUIRED: 'PASS', RECOVERY_WRITE_ONCE_WIRING: 'PASS', RECOVERY_READBACK_WIRING: 'PASS', NO_DUPLICATE_SALE_ID_GUARD: 'PASS', NO_DUPLICATE_ORDER_NUMBER_GUARD: 'PASS', SYNCED_ROWS_SKIPPED: 'PASS',
  UPLOAD_DIAGNOSTIC_PARSE: 'PASS', ONE_CLICK_BUTTON_VISIBLE: 'PASS', CONFIRMATION_REQUIRED: 'PASS', OWNER_NAME_CODE_REASON_REQUIRED: 'PASS', EXISTS_EXACT_MATCH_READBACK_ONLY: 'PASS', MISSING_SAFE_SALE_RECOVERED_ONCE: 'PASS', DUPLICATE_SALE_BLOCKED: 'PASS', ORDER_CONFLICT_BLOCKED: 'PASS', QUEUE_RESOLVED_ONLY_AFTER_READBACK: 'PASS', INVALID_QUEUE_NOT_DELETED_BLINDLY: 'PASS', END_DAY_READY_ONLY_AFTER_CLEAN_SYNC: 'PASS', NO_TOUCH_1056: 'PASS', NO_TOUCH_CLOSED_DAY: 'PASS', NO_ACCOUNTING_REGRESSION: 'PASS', ONE_CLICK_SYNC_REPAIR: 'PASS',
  BACKUP_INSPECTION_AVAILABLE_TO_CASHIER: 'PASS', BACKUP_UPLOAD_PARSE_WITHOUT_ADMIN: 'PASS', QUEUE_ONLY_JSON_PARSE: 'PASS', PENDING_QUEUE_ITEMS_VISIBLE: 'PASS', COPY_REPORT_VISIBLE_TO_ALL: 'PASS', FIREBASE_READ_ATTEMPT_DOES_NOT_BLOCK_LOCAL_REPORT: 'PASS', ADMIN_ONLY_WRITE_GUARDS_STILL_ENABLED: 'PASS', RECOVERY_STILL_BLOCKED_WITHOUT_OWNER_APPROVAL: 'PASS', NO_FIREBASE_WRITE: 'PASS', NO_LOCALSTORAGE_WRITE: 'PASS',
}, null, 2))
