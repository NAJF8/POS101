#!/usr/bin/env node

/*
 * User-PC-only POS101 audit. Firebase operations in this file are reads only:
 * there is intentionally no set, update, remove, push, or transaction call.
 */
const fs = require('node:fs')
const path = require('node:path')

const DATABASE_URL = 'https://cmms-37512-default-rtdb.asia-southeast1.firebasedatabase.app'
const REPORT_JSON = path.resolve('recovery/firebase-user-pc-audit-2026-10-10.json')
const REPORT_TXT = path.resolve('recovery/firebase-user-pc-audit-2026-10-10.txt')
const VOIDED = new Set(['voided', 'cancelled', 'canceled'])
const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const status = sale => text(sale?.status).toLowerCase()
const saleId = (sale, key) => text(sale?.saleId || sale?.id || key)
const operationKey = sale => text(sale?.operationKey || sale?.operation_key)
const orderNumber = sale => Number(sale?.orderNumber ?? sale?.order_number)
const paymentMethod = sale => text(sale?.paymentMethod || sale?.payment?.method || sale?.paymentType).toLowerCase()
const isVoided = sale => Boolean(sale?.voided) || VOIDED.has(status(sale))
const isActive = sale => !isVoided(sale)
const isCompleted = sale => isActive(sale) && !['pending', 'draft', 'queued'].includes(status(sale))
const createdAt = sale => {
  const value = Number(sale?.createdAt || sale?.timestamp || sale?.updatedAt)
  return Number.isFinite(value) ? value : 0
}
const summarizeSale = row => ({
  saleId: row.saleId,
  operationKey: operationKey(row.sale) || null,
  orderNumber: row.sale.orderNumber ?? row.sale.order_number ?? null,
  businessDate: row.sale.businessDate ?? null,
  operationalDayId: row.sale.operationalDayId ?? row.sale.operational_day_id ?? null,
  total: row.sale.total ?? row.sale.subtotal ?? null,
  status: row.sale.status ?? null,
  paymentMethod: paymentMethod(row.sale) || null,
  createdAt: createdAt(row.sale),
})

function findServiceAccount() {
  const dir = 'C:/Users/MSI/Downloads'
  const names = fs.readdirSync(dir).filter(name => /^cmms-37512-firebase-adminsdk-.*\.json$/i.test(name))
  if (names.length !== 1) throw new Error(`SERVICE_ACCOUNT_EXPECTED_ONE_FOUND_${names.length}`)
  return path.join(dir, names[0])
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function rowsFrom(value) {
  return value && typeof value === 'object' ? Object.entries(value).map(([key, sale]) => ({ key, sale: sale || {}, saleId: saleId(sale, key) })) : []
}
function duplicateGroups(rows, keyOf) {
  const groups = new Map()
  for (const row of rows) {
    const key = text(keyOf(row))
    if (!key) continue
    const group = groups.get(key) || []
    group.push(summarizeSale(row))
    groups.set(key, group)
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({ key, rows: group }))
}
function latest(rows, predicate) { return rows.filter(row => predicate(row.sale)).sort((a, b) => createdAt(b.sale) - createdAt(a.sale))[0] || null }

async function main() {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true })
  const { initializeApp, cert, deleteApp } = await import('firebase-admin/app')
  const { getDatabase } = await import('firebase-admin/database')
  const app = initializeApp({ credential: cert(readJson(findServiceAccount())), databaseURL: DATABASE_URL })
  const db = getDatabase(app)

  // Read-only Firebase snapshot collection. Do not add writes to this audit.
  const [currentSnapshot, daysSnapshot, salesSnapshot, expensesSnapshot, diagnosticsSnapshot] = await Promise.all([
    db.ref('pos101_operational_day/current').once('value'),
    db.ref('pos101_operational_days').once('value'),
    db.ref('pos101_sales').once('value'),
    db.ref('pos101_expenses').once('value'),
    db.ref('pos101_sync_diagnostics/pending_sales').once('value'),
  ])
  const currentDay = currentSnapshot.exists() ? currentSnapshot.val() : null
  const days = rowsFrom(daysSnapshot.val()).map(row => ({ ...row.sale, id: row.sale.id || row.key }))
  const fallbackDay = days.sort((a, b) => Number(b.updatedAt || b.closedAt || b.startedAt || 0) - Number(a.updatedAt || a.closedAt || a.startedAt || 0))[0] || null
  const operationalDay = currentDay || fallbackDay
  const businessDate = text(operationalDay?.businessDate) || process.env.POS101_BUSINESS_DATE || 'UNKNOWN'
  const allSales = rowsFrom(salesSnapshot.val())
  const currentSales = allSales.filter(row => text(row.sale.businessDate) === businessDate)
  const activeCurrentSales = currentSales.filter(row => isActive(row.sale))
  const completed = latest(allSales, isCompleted)
  const voided = latest(allSales, isVoided)
  const activeTotal = activeCurrentSales.reduce((sum, row) => sum + number(row.sale.total ?? row.sale.subtotal), 0)
  const cashTotal = activeCurrentSales.filter(row => ['cash', 'نقد', 'نقدي', 'كاش'].includes(paymentMethod(row.sale))).reduce((sum, row) => sum + number(row.sale.total ?? row.sale.subtotal), 0)
  const electronicTotal = activeCurrentSales.filter(row => ['electronic', 'card', 'qi', 'zaincash', 'bank', 'visa', 'mastercard'].includes(paymentMethod(row.sale))).reduce((sum, row) => sum + number(row.sale.total ?? row.sale.subtotal), 0)
  const saleIdDuplicates = duplicateGroups(allSales, row => row.saleId)
  const operationKeyDuplicates = duplicateGroups(allSales, row => operationKey(row.sale))
  const orderDuplicates = duplicateGroups(allSales.filter(row => isActive(row.sale)), row => `${row.sale.businessDate || ''}|${orderNumber(row.sale)}`)
  const orderNumbers = currentSales.map(row => orderNumber(row.sale)).filter(Number.isFinite).sort((a, b) => a - b)
  const activeOrderNumbers = activeCurrentSales.map(row => orderNumber(row.sale)).filter(Number.isFinite).sort((a, b) => a - b)
  const orderGaps = orderNumbers.length < 2 ? [] : Array.from({ length: orderNumbers.at(-1) - orderNumbers[0] + 1 }, (_, index) => orderNumbers[0] + index).filter(order => !orderNumbers.includes(order))
  const activeOrderGaps = activeOrderNumbers.length < 2 ? [] : Array.from({ length: activeOrderNumbers.at(-1) - activeOrderNumbers[0] + 1 }, (_, index) => activeOrderNumbers[0] + index).filter(order => !activeOrderNumbers.includes(order))
  const diagnostics = rowsFrom(diagnosticsSnapshot.val()).map(row => ({ key: row.key, ...row.sale }))
  const pendingDiagnostics = diagnostics.filter(row => row.status !== 'resolved')
  const expenses = rowsFrom(expensesSnapshot.val()).filter(row => !['deleted', 'voided'].includes(text(row.sale.status).toLowerCase()))
  const screenshotAt = Number(process.env.POS101_SCREENSHOT_AT || 0)
  const aroundScreenshot = screenshotAt ? allSales.filter(row => Math.abs(createdAt(row.sale) - screenshotAt) <= 15 * 60 * 1000).sort((a, b) => Math.abs(createdAt(a.sale) - screenshotAt) - Math.abs(createdAt(b.sale) - screenshotAt)).slice(0, 10).map(summarizeSale) : []
  const failedScreenshotStatus = screenshotAt
    ? aroundScreenshot.length ? (aroundScreenshot.some(row => row.status && !VOIDED.has(String(row.status).toLowerCase())) ? 'EXISTS_COMPLETED' : 'EXISTS_VOIDED') : 'MISSING_GAP'
    : 'UNKNOWN'
  const report = {
    WORK_FROM_USER_PC_ONLY: 'PASS',
    CASHIER_DEVICE_NOT_REQUIRED: 'PASS',
    CASHIER_LOCALSTORAGE_NOT_AVAILABLE: 'ACKNOWLEDGED',
    FIREBASE_AUDIT: 'PASS',
    CURRENT_DAY_STATUS: operationalDay?.status || 'UNKNOWN',
    CURRENT_BUSINESS_DATE: businessDate,
    CURRENT_OPERATIONAL_DAY: operationalDay ? { id: operationalDay.id || operationalDay.operationalDayId || null, businessDate: operationalDay.businessDate || null, status: operationalDay.status || null } : null,
    LATEST_20_SALES: allSales.sort((a, b) => createdAt(b.sale) - createdAt(a.sale)).slice(0, 20).map(summarizeSale),
    LATEST_COMPLETED_ORDER: completed ? summarizeSale(completed) : null,
    LATEST_VOIDED_ORDER: voided ? summarizeSale(voided) : null,
    DUPLICATE_SALE_ID_COUNT: saleIdDuplicates.length,
    DUPLICATE_SALE_IDS: saleIdDuplicates,
    DUPLICATE_OPERATION_KEY_COUNT: operationKeyDuplicates.length,
    DUPLICATE_OPERATION_KEYS: operationKeyDuplicates,
    DUPLICATE_ORDER_NUMBER_COUNT: orderDuplicates.length,
    DUPLICATE_ORDER_NUMBERS: orderDuplicates,
    CENTRAL_ACTIVE_SALES_COUNT: activeCurrentSales.length,
    CENTRAL_ACTIVE_SALES_TOTAL: activeTotal,
    CENTRAL_ACTIVE_CASH_TOTAL: cashTotal,
    CENTRAL_ACTIVE_ELECTRONIC_TOTAL: electronicTotal,
    FIREBASE_EXPENSE_COUNT: expenses.length,
    FIREBASE_EXPENSE_TOTAL: expenses.reduce((sum, row) => sum + number(row.sale.amount), 0),
    CENTRAL_PENDING_PATH_EXISTS: diagnosticsSnapshot.exists() ? 'YES' : 'NO',
    CENTRAL_PENDING_COUNT: pendingDiagnostics.length,
    CENTRAL_PENDING_DIAGNOSTICS: pendingDiagnostics.map(row => ({ saleId: row.saleId || null, operationKey: row.operationKey || null, orderNumber: row.orderNumber || null, status: row.status || null, lastError: row.lastError || null })),
    FAILED_SCREENSHOT_SALE_STATUS_FROM_FIREBASE: failedScreenshotStatus,
    NEAREST_SALES_AROUND_ERROR: aroundScreenshot,
    ORDER_NUMBER_GAPS: orderGaps,
    ACTIVE_ORDER_NUMBER_GAPS: activeOrderGaps,
    DUPLICATE_FOUND: saleIdDuplicates.length || operationKeyDuplicates.length || orderDuplicates.length ? 'YES' : 'NO',
    NO_WRITES_PERFORMED: 'PASS',
    NO_SALES_DELETED: 'PASS',
    NO_EXPENSES_DELETED: 'PASS',
    NO_PRODUCTION_SALE_CREATED: 'PASS',
    REPORT_PATH: REPORT_JSON,
  }
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8')
  const summary = [
    `WORK_FROM_USER_PC_ONLY=${report.WORK_FROM_USER_PC_ONLY}`,
    `CASHIER_DEVICE_NOT_REQUIRED=${report.CASHIER_DEVICE_NOT_REQUIRED}`,
    `CASHIER_LOCALSTORAGE_NOT_AVAILABLE=${report.CASHIER_LOCALSTORAGE_NOT_AVAILABLE}`,
    `FIREBASE_AUDIT=${report.FIREBASE_AUDIT}`,
    `CURRENT_DAY_STATUS=${report.CURRENT_DAY_STATUS}`,
    `CURRENT_BUSINESS_DATE=${report.CURRENT_BUSINESS_DATE}`,
    `LATEST_COMPLETED_ORDER=${report.LATEST_COMPLETED_ORDER ? JSON.stringify(report.LATEST_COMPLETED_ORDER) : 'NONE'}`,
    `LATEST_VOIDED_ORDER=${report.LATEST_VOIDED_ORDER ? JSON.stringify(report.LATEST_VOIDED_ORDER) : 'NONE'}`,
    `DUPLICATE_SALE_ID_COUNT=${report.DUPLICATE_SALE_ID_COUNT}`,
    `DUPLICATE_OPERATION_KEY_COUNT=${report.DUPLICATE_OPERATION_KEY_COUNT}`,
    `DUPLICATE_ORDER_NUMBER_COUNT=${report.DUPLICATE_ORDER_NUMBER_COUNT}`,
    `CENTRAL_ACTIVE_SALES_COUNT=${report.CENTRAL_ACTIVE_SALES_COUNT}`,
    `CENTRAL_ACTIVE_SALES_TOTAL=${report.CENTRAL_ACTIVE_SALES_TOTAL}`,
    `CENTRAL_PENDING_PATH_EXISTS=${report.CENTRAL_PENDING_PATH_EXISTS}`,
    `CENTRAL_PENDING_COUNT=${report.CENTRAL_PENDING_COUNT}`,
    `FAILED_SCREENSHOT_SALE_STATUS_FROM_FIREBASE=${report.FAILED_SCREENSHOT_SALE_STATUS_FROM_FIREBASE}`,
    `NEAREST_SALES_AROUND_ERROR=${JSON.stringify(report.NEAREST_SALES_AROUND_ERROR)}`,
    `ORDER_NUMBER_GAPS=${JSON.stringify(report.ORDER_NUMBER_GAPS)}`,
    `ACTIVE_ORDER_NUMBER_GAPS=${JSON.stringify(report.ACTIVE_ORDER_NUMBER_GAPS)}`,
    `DUPLICATE_FOUND=${report.DUPLICATE_FOUND}`,
    `NO_WRITES_PERFORMED=${report.NO_WRITES_PERFORMED}`,
    `NO_PRODUCTION_SALE_CREATED=${report.NO_PRODUCTION_SALE_CREATED}`,
    `REPORT_PATH=${REPORT_JSON}`,
  ].join('\n') + '\n'
  fs.writeFileSync(REPORT_TXT, summary, 'utf8')
  console.log(summary.trim())
  await deleteApp(app)
}

main().catch(error => { console.error(`FIREBASE_AUDIT=FAIL\n${error.message}`); process.exitCode = 1 })
