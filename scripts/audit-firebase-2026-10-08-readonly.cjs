#!/usr/bin/env node

/* POS101 read-only Firebase audit. This file deliberately contains no set,
   update, remove, transaction, or queue-cleanup operation. */

const fs = require('node:fs')
const path = require('node:path')

const BUSINESS_DATE = '2026-10-08'
const DATABASE_URL = 'https://cmms-37512-default-rtdb.asia-southeast1.firebasedatabase.app'
const SALES_PATH = 'pos101_sales'
const EXPECTED_COUNT = 23
const EXPECTED_TOTAL = 347000
const RECOVERED_SALE_ID = '01173ea8-0d1a-438e-ac07-1dd97035961d'
const REPORT_JSON = path.resolve('recovery/firebase-audit-2026-10-08.json')
const REPORT_TXT = path.resolve('recovery/firebase-audit-2026-10-08.txt')
const VOIDED_STATUSES = new Set(['voided', 'cancelled', 'canceled'])

const text = value => String(value ?? '').trim()
const saleIdOf = (sale, key) => text(sale?.saleId || sale?.id || key)
const orderNumberOf = sale => text(sale?.orderNumber)
const operationalDayOf = sale => text(sale?.operationalDayId)
const statusOf = sale => text(sale?.status).toLowerCase()
const isActive = sale => !VOIDED_STATUSES.has(statusOf(sale))
const totalOf = sale => Number(sale?.total)
const paymentMethodOf = sale => text(sale?.paymentMethod || sale?.payment?.method || sale?.paymentType).toLowerCase()

function findServiceAccount() {
  const directory = 'C:/Users/MSI/Downloads'
  const names = fs.readdirSync(directory).filter(name => /^cmms-37512-firebase-adminsdk-.*\.json$/i.test(name))
  if (names.length !== 1) throw new Error(`SERVICE_ACCOUNT_EXPECTED_ONE_FOUND_${names.length}`)
  return path.join(directory, names[0])
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { throw new Error(`INVALID_JSON:${label}:${error.message}`) }
}

function addGrouped(map, key, sale) {
  const current = map.get(key) || { count: 0, total: 0 }
  current.count += 1
  current.total += totalOf(sale)
  map.set(key, current)
}

function isCash(method) {
  return ['cash', 'نقد', 'نقدي', 'كاش'].includes(method)
}

function isElectronic(method) {
  return ['card', 'electronic', 'bank', 'qi', 'zaincash', 'زين كاش', 'كي كارد', 'mastercard', 'visa'].includes(method)
}

function formatList(value) { return value.length ? value.join(',') : 'NONE' }

function textSummary(report) {
  return [
    `FIREBASE_READONLY_AUDIT=${report.FIREBASE_READONLY_AUDIT}`,
    `BUSINESS_DATE=${BUSINESS_DATE}`,
    `ACTIVE_COUNT=${report.ACTIVE_COUNT}`,
    `ACTIVE_TOTAL=${report.ACTIVE_TOTAL}`,
    `CASH_TOTAL=${report.CASH_TOTAL}`,
    `ELECTRONIC_TOTAL=${report.ELECTRONIC_TOTAL}`,
    `ORDER_NUMBERS=${formatList(report.ORDER_NUMBERS)}`,
    `SALE_IDS=${formatList(report.SALE_IDS)}`,
    `EXPECTED_COUNT=${EXPECTED_COUNT}`,
    `EXPECTED_TOTAL=${EXPECTED_TOTAL}`,
    `COUNT_MATCH=${report.COUNT_MATCH}`,
    `TOTAL_MATCH=${report.TOTAL_MATCH}`,
    `READBACK_1318=${report.READBACK_1318}`,
    `NO_DUPLICATE_SALE_ID=${report.NO_DUPLICATE_SALE_ID}`,
    `NO_DUPLICATE_ORDER_CONFLICT=${report.NO_DUPLICATE_ORDER_CONFLICT}`,
    `PENDING_LIKE_COUNT=${report.PENDING_LIKE_COUNT}`,
    `DISTINCT_OPERATIONAL_DAY_IDS=${formatList(report.DISTINCT_OPERATIONAL_DAY_IDS)}`,
    `MIN_ORDER_NUMBER=${report.MIN_ORDER_NUMBER ?? 'NONE'}`,
    `MAX_ORDER_NUMBER=${report.MAX_ORDER_NUMBER ?? 'NONE'}`,
    `ORDER_RANGE_1297_1318_PRESENT=${report.ORDER_RANGE_1297_1318_PRESENT}`,
    `CENTRAL_MISSING_DATA_COUNT=${report.CENTRAL_MISSING_DATA.length}`,
    `NO_TOUCH_1056=${report.NO_TOUCH_1056}`,
    `NO_TOUCH_CLOSED_DAY_2026_10_07=${report.NO_TOUCH_CLOSED_DAY_2026_10_07}`,
    `READY_TO_CLOSE_DAY=${report.READY_TO_CLOSE_DAY}`,
    `REPORT_PATH=${REPORT_JSON}`,
  ].join('\n') + '\n'
}

async function main() {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true })
  const { initializeApp, cert, deleteApp } = await import('firebase-admin/app')
  const { getDatabase } = await import('firebase-admin/database')
  const serviceAccount = readJson(findServiceAccount(), 'service-account')
  const app = initializeApp({ credential: cert(serviceAccount), databaseURL: DATABASE_URL })
  const db = getDatabase(app)

  // The only Firebase operation in this script is a read.
  const snapshot = await db.ref(SALES_PATH).once('value')
  const raw = snapshot.val()
  if (!raw || typeof raw !== 'object') throw new Error('CANONICAL_SALES_PATH_EMPTY_OR_INVALID')
  const allRows = Object.entries(raw).map(([key, sale]) => ({ key, sale: sale || {} }))
  const currentRows = allRows.filter(({ sale }) => text(sale.businessDate) === BUSINESS_DATE && isActive(sale))
  const currentSales = currentRows.map(({ key, sale }) => ({ key, sale, saleId: saleIdOf(sale, key) }))

  const saleIds = currentSales.map(row => row.saleId)
  const orderNumbers = currentSales.map(row => Number(row.sale.orderNumber)).filter(Number.isFinite).sort((a, b) => a - b)
  const activeTotal = currentSales.reduce((sum, row) => sum + totalOf(row.sale), 0)
  const cashTotal = currentSales.filter(row => isCash(paymentMethodOf(row.sale))).reduce((sum, row) => sum + totalOf(row.sale), 0)
  const electronicTotal = currentSales.filter(row => isElectronic(paymentMethodOf(row.sale))).reduce((sum, row) => sum + totalOf(row.sale), 0)
  const unknownPaymentRows = currentSales.filter(row => !isCash(paymentMethodOf(row.sale)) && !isElectronic(paymentMethodOf(row.sale)))

  const saleIdCounts = new Map()
  for (const id of saleIds) saleIdCounts.set(id, (saleIdCounts.get(id) || 0) + 1)
  const duplicateSaleIds = [...saleIdCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id)

  const orderGroups = new Map()
  for (const row of currentSales) {
    const key = `${BUSINESS_DATE}|${operationalDayOf(row.sale)}|${orderNumberOf(row.sale)}`
    const group = orderGroups.get(key) || []
    group.push({ saleId: row.saleId, orderNumber: row.sale.orderNumber, operationalDayId: row.sale.operationalDayId })
    orderGroups.set(key, group)
  }
  const duplicateOrderConflicts = [...orderGroups.entries()]
    .filter(([, rows]) => new Set(rows.map(row => row.saleId)).size > 1)
    .map(([group, rows]) => ({ group, rows }))

  const recoveredRows = currentSales.filter(row => Number(row.sale.orderNumber) === 1318)
  const recovered = recoveredRows.find(row => row.saleId === RECOVERED_SALE_ID)
  const recoveredMatches = Boolean(recovered && totalOf(recovered.sale) === 21000
    && text(recovered.sale.businessDate) === BUSINESS_DATE && !VOIDED_STATUSES.has(statusOf(recovered.sale)))
  const readback1318 = recoveredMatches && recoveredRows.length === 1
    ? 'PASS' : 'FAIL'

  const pendingLike = currentSales.filter(row => row.sale.syncStatus === 'pending'
    || statusOf(row.sale) === 'pending' || row.sale.centralVerified !== true)
    .map(row => ({
      saleId: row.saleId,
      orderNumber: row.sale.orderNumber,
      total: row.sale.total,
      syncStatus: row.sale.syncStatus ?? null,
      status: row.sale.status ?? null,
      centralVerified: row.sale.centralVerified ?? null,
      classification: row.sale.centralVerified === true && row.sale.syncStatus === 'pending'
        ? 'LOCAL_BROWSER_PENDING_FIREBASE_EXISTS' : row.sale.centralVerified !== true ? 'NEEDS_REVIEW' : 'PENDING',
    }))
  const centralMissingData = currentSales.filter(row => !row.saleId || !orderNumberOf(row.sale)
    || !Number.isFinite(totalOf(row.sale)) || !operationalDayOf(row.sale)
    || text(row.sale.businessDate) !== BUSINESS_DATE)
    .map(row => ({ saleId: row.saleId, orderNumber: row.sale.orderNumber, missing: [
      !row.saleId && 'saleId', !orderNumberOf(row.sale) && 'orderNumber',
      !Number.isFinite(totalOf(row.sale)) && 'total', !operationalDayOf(row.sale) && 'operationalDayId',
      text(row.sale.businessDate) !== BUSINESS_DATE && 'businessDate',
    ].filter(Boolean) }))

  const operationalDayIds = [...new Set(currentSales.map(row => operationalDayOf(row.sale)).filter(Boolean))].sort()
  const cashierGroups = new Map()
  for (const row of currentSales) addGrouped(cashierGroups, text(row.sale.seller || row.sale.cashierNameSnapshot || row.sale.cashierId || 'UNKNOWN'), row.sale)
  const cashierSummary = Object.fromEntries([...cashierGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value]))
  const protected1056 = allRows.filter(({ sale }) => Number(sale.orderNumber) === 1056)
    .map(({ key, sale }) => ({ key, saleId: saleIdOf(sale, key), businessDate: sale.businessDate ?? null, operationalDayId: sale.operationalDayId ?? null, total: sale.total ?? null }))
  const closedDayRecords = allRows.filter(({ sale }) => text(sale.businessDate) === '2026-10-07').length

  const report = {
    FIREBASE_READONLY_AUDIT: 'PASS',
    BUSINESS_DATE: BUSINESS_DATE,
    CANONICAL_SALES_PATH: SALES_PATH,
    FIREBASE_TOTAL_SALE_RECORDS: allRows.length,
    ACTIVE_COUNT: currentSales.length,
    ACTIVE_TOTAL: activeTotal,
    CASH_TOTAL: cashTotal,
    ELECTRONIC_TOTAL: electronicTotal,
    UNKNOWN_PAYMENT_TOTAL: activeTotal - cashTotal - electronicTotal,
    UNKNOWN_PAYMENT_ROWS: unknownPaymentRows.map(row => ({ saleId: row.saleId, orderNumber: row.sale.orderNumber, method: paymentMethodOf(row.sale) || null, total: row.sale.total })),
    ORDER_NUMBERS: orderNumbers,
    SALE_IDS: saleIds,
    EXPECTED_COUNT: EXPECTED_COUNT,
    EXPECTED_TOTAL: EXPECTED_TOTAL,
    COUNT_MATCH: currentSales.length === EXPECTED_COUNT ? 'PASS' : 'FAIL',
    TOTAL_MATCH: activeTotal === EXPECTED_TOTAL ? 'PASS' : 'FAIL',
    DUPLICATE_SALE_IDS: duplicateSaleIds,
    NO_DUPLICATE_SALE_ID: duplicateSaleIds.length === 0 ? 'PASS' : 'FAIL',
    DUPLICATE_ORDER_CONFLICTS: duplicateOrderConflicts,
    NO_DUPLICATE_ORDER_CONFLICT: duplicateOrderConflicts.length === 0 ? 'PASS' : 'FAIL',
    RECOVERED_ORDER_1318: recovered ? { saleId: recovered.saleId, orderNumber: recovered.sale.orderNumber, total: recovered.sale.total, businessDate: recovered.sale.businessDate, status: recovered.sale.status ?? null, syncStatus: recovered.sale.syncStatus ?? null, centralVerified: recovered.sale.centralVerified ?? null } : null,
    READBACK_1318: readback1318,
    PENDING_LIKE_COUNT: pendingLike.length,
    PENDING_LIKE: pendingLike,
    DISTINCT_OPERATIONAL_DAY_IDS: operationalDayIds,
    OPERATIONAL_DAY_ID_WARNING: operationalDayIds.length > 1 ? 'WARNING_MULTIPLE_IDS' : 'NONE',
    MIN_ORDER_NUMBER: orderNumbers.length ? Math.min(...orderNumbers) : null,
    MAX_ORDER_NUMBER: orderNumbers.length ? Math.max(...orderNumbers) : null,
    ORDER_RANGE_1297_1318_PRESENT: [1297, 1318].every(order => orderNumbers.includes(order)) ? 'PASS' : 'WARNING',
    ORDER_RANGE_1297_1318_MISSING: Array.from({ length: 22 }, (_, index) => 1297 + index).filter(order => !orderNumbers.includes(order)),
    CASHIER_SELLER_SUMMARY: cashierSummary,
    CENTRAL_MISSING_DATA: centralMissingData,
    PROTECTED_ORDER_1056_RECORDS: protected1056,
    CLOSED_DAY_2026_10_07_RECORD_COUNT: closedDayRecords,
    NO_TOUCH_1056: 'PASS',
    NO_TOUCH_CLOSED_DAY_2026_10_07: 'PASS',
    NO_WRITES_PERFORMED: 'PASS',
    NO_DELETES_PERFORMED: 'PASS',
    NO_UPDATES_PERFORMED: 'PASS',
    NO_END_DAY_CLOSE: 'PASS',
    READY_TO_CLOSE_DAY: currentSales.length === EXPECTED_COUNT && activeTotal === EXPECTED_TOTAL
      && readback1318 === 'PASS' && duplicateSaleIds.length === 0 && duplicateOrderConflicts.length === 0 && centralMissingData.length === 0 ? 'YES' : 'NO',
  }
  report.FIREBASE_READONLY_AUDIT = report.READY_TO_CLOSE_DAY === 'YES' ? 'PASS' : 'FAIL'
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8')
  fs.writeFileSync(REPORT_TXT, textSummary(report), 'utf8')
  console.log(textSummary(report).trim())
  await deleteApp(app)
  if (report.FIREBASE_READONLY_AUDIT !== 'PASS') process.exitCode = 1
}

main().catch(error => { console.error(`FIREBASE_READONLY_AUDIT=FAIL\n${error.message}`); process.exitCode = 1 })
