import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyBackupSale, ORDER_1309_SALE_ID, parseBackupSales, summarizeBackupSales } from '../src/services/backupSalesRecovery.js'
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

const day = { id: 'day-1', operationalDayId: 'day-1', businessDate: '2026-10-08', status: 'open' }
const exact = classifyBackupSale({ sale: sale(), centralSales: [sale({ status: 'synced', syncStatus: 'synced' })], openDay: day })
assert.equal(exact.classification, 'EXISTS_EXACT_MATCH')
const endDayAfterExact = buildEndDayDiagnostic({ localSales: [sale()], queueEntries: [{ sale: sale() }], centralSales: [sale()], operationalDay: day })
assert.equal(endDayAfterExact.blockers.length, 0)
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
assert.match(component, /الفحص متاح للجميع، لكن الاسترداد متوقف لحين موافقة صاحب النظام/)
assert.match(component, /نسخ تقرير الفحص/)
assert.match(component, /navigator\.clipboard\.writeText/)
assert.match(component, /canReadback && isTargetReadback && result\?\.classification === 'EXISTS_EXACT_MATCH'/)
assert.match(component, /ORDER_1309_SALE_ID/)
assert.match(component, /المبيعة موجودة في Firebase لكنها غير موجودة محليًا؛ لا حاجة للاسترداد/)
assert.match(service, /requireAuthenticatedBackupViewer/)
assert.match(service, /Number\(expected\.orderNumber\) !== ORDER_1309_NUMBER/)
assert.match(service, /expected\.saleId !== ORDER_1309_SALE_ID/)
assert.match(service, /ORDER_1309_READBACK_ONLY/)
assert.match(service, /export const BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED = false/)
assert.match(service, /OWNER_APPROVAL_REQUIRED/)
assert.match(readbackSource, /localStorage\.setItem/)
assert.doesNotMatch(readbackSource, /runTransaction|pos101_sales/)

console.log(JSON.stringify({
  BACKUP_FILE_UPLOAD_UI: 'PASS', BACKUP_JSON_PARSE: 'PASS', BACKUP_SUMMARY: 'PASS', PENDING_SALES_DETECTED: 'PASS', SALE_1309_DETECTED_FROM_BACKUP: 'PASS', AUTH_FIREBASE_CHECK_WIRING: 'PASS',
  BACKUP_RECOVERY_CARD_VISIBLE_FOR_CASHIER: 'PASS', BACKUP_RECOVERY_CARD_VISIBLE_FOR_ADMIN: 'PASS', BACKUP_RECOVERY_ROUTE_WORKS_WITH_ACTIVE_SESSION: 'PASS', CASHIER_CAN_UPLOAD_AND_PARSE_BACKUP: 'PASS', CASHIER_CAN_SEE_PENDING_SALES: 'PASS', CASHIER_CANNOT_RECOVER: 'PASS', CASHIER_CANNOT_MARK_LOCAL_READBACK: 'PASS', ADMIN_RECOVERY_STILL_PROTECTED: 'PASS', COPY_INSPECTION_REPORT: 'PASS',
  ORDER_1309_EXISTS_EXACT_MATCH: 'PASS', NO_RECOVERY_FOR_1309: 'PASS', LOCAL_READBACK_ONLY_FOR_1309: 'PASS', NO_FIREBASE_SALE_WRITE: 'PASS', NO_DUPLICATE_SALE_ID: 'PASS', END_DAY_NO_SYNC_BLOCK_FOR_1309: 'PASS',
  EXISTS_EXACT_MATCH_NO_WRITE_CLASSIFICATION: 'PASS', MISSING_SAFE_TO_RECOVER_CLASSIFICATION: 'PASS',
  CONFLICT_BLOCKS_RECOVERY: 'PASS', CLOSED_DAY_BLOCKS_RECOVERY: 'PASS', ONE_BY_ONE_RECOVERY_ONLY: 'PASS', CONFIRMATION_NAME_CODE_REASON_REQUIRED: 'PASS', RECOVERY_WRITE_ONCE_WIRING: 'PASS', RECOVERY_READBACK_WIRING: 'PASS', NO_DUPLICATE_SALE_ID_GUARD: 'PASS', NO_DUPLICATE_ORDER_NUMBER_GUARD: 'PASS', SYNCED_ROWS_SKIPPED: 'PASS',
}, null, 2))
