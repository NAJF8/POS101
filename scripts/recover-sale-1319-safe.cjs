#!/usr/bin/env node

// Target-only recovery for sale 1319. No queue, localStorage, order number,
// or unrelated Firebase node is modified.
const fs = require('node:fs')
const path = require('node:path')

const SALE_ID = '778a2d50-45a0-440e-901d-31767e3e031e'
const ORDER_NUMBER = '1319'
const BUSINESS_DATE = '2026-10-08'
const OPERATIONAL_DAY_ID = '243e4119-2acb-481e-98e5-78af884f4a05'
const TOTAL = 4000
const DATABASE_URL = 'https://cmms-37512-default-rtdb.asia-southeast1.firebasedatabase.app'
const TARGET_PATH = `pos101_sales/${SALE_ID}`
const extractPath = 'C:/Users/MSI/Downloads/pos101-order-1319-missing-sale-extract.json'
const serviceAccountPath = 'C:/Users/MSI/Downloads/cmms-37512-firebase-adminsdk-fbsvc-094062cb90.json'

const text = value => String(value ?? '').trim()
const idOf = row => text(row?.saleId || row?.id)
const itemsOf = row => Array.isArray(row?.items) ? row.items : []
const comparable = row => ({
  saleId: idOf(row), operationKey: text(row?.operationKey), orderNumber: text(row?.orderNumber),
  businessDate: text(row?.businessDate), operationalDayId: text(row?.operationalDayId),
  total: Number(row?.total), paymentMethod: text(row?.paymentMethod || row?.payment?.method),
  items: itemsOf(row).map(item => ({ id: text(item?.id), name: text(item?.name), quantity: Number(item?.quantity), price: Number(item?.price) })),
})
const exact = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
const active = row => !['voided', 'cancelled', 'canceled'].includes(text(row?.status).toLowerCase())
const fail = message => { console.error(`SALE_1319_UPLOAD=FAIL\n${message}`); process.exitCode = 1 }

async function main() {
  if (!fs.existsSync(extractPath)) return fail(`EXTRACT_NOT_FOUND:${extractPath}`)
  if (!fs.existsSync(serviceAccountPath)) return fail('SERVICE_ACCOUNT_NOT_FOUND')
  const extracted = JSON.parse(fs.readFileSync(extractPath, 'utf8'))
  const sale = extracted?.sale
  if (!sale || idOf(sale) !== SALE_ID || text(sale.orderNumber) !== ORDER_NUMBER || Number(sale.total) !== TOTAL || text(sale.businessDate) !== BUSINESS_DATE || text(sale.operationalDayId) !== OPERATIONAL_DAY_ID) return fail('TARGET_PAYLOAD_IDENTITY_MISMATCH')
  if (!exact(sale, { ...sale, paymentMethod: 'cash' })) return fail('TARGET_PAYLOAD_INVALID')

  const { initializeApp, cert, deleteApp } = await import('firebase-admin/app')
  const { getDatabase } = await import('firebase-admin/database')
  const app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))), databaseURL: DATABASE_URL })
  try {
    const db = getDatabase(app)
    const salesRef = db.ref('pos101_sales')
    const root = (await salesRef.once('value')).val() || {}
    const existing = root[SALE_ID]
    const sameOrder = Object.entries(root).filter(([id, row]) => id !== SALE_ID && active(row) && text(row?.businessDate) === BUSINESS_DATE && text(row?.operationalDayId) === OPERATIONAL_DAY_ID && text(row?.orderNumber) === ORDER_NUMBER)
    if (sameOrder.length) return fail(`ORDER_CONFLICT:${sameOrder.map(([id]) => id).join(',')}`)
    let action = 'EXISTS_EXACT_MATCH'
    if (existing && !exact(sale, existing)) return fail('SALE_ID_CONFLICT')
    if (!existing) {
      await salesRef.child(SALE_ID).set(sale)
      action = 'RECOVERED_ONCE'
    }
    const readback = (await salesRef.child(SALE_ID).once('value')).val()
    if (!readback || !exact(sale, readback)) return fail('SALE_1319_READBACK_FAILED')
    const rows = Object.values((await salesRef.once('value')).val() || {}).filter(row => active(row) && text(row?.businessDate) === BUSINESS_DATE)
    const ids = rows.map(idOf)
    const orders = rows.map(row => `${text(row?.businessDate)}|${text(row?.operationalDayId)}|${text(row?.orderNumber)}`)
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
    const duplicateOrders = orders.filter((key, index) => orders.indexOf(key) !== index)
    const total = rows.reduce((sum, row) => sum + Number(row?.total || 0), 0)
    console.log(JSON.stringify({ SALE_1319_UPLOAD: 'PASS', FIREBASE_ACTION: action, SALE_1319_READBACK: 'PASS', ACTIVE_COUNT: rows.length, ACTIVE_TOTAL: total, NO_DUPLICATE_SALE_ID: duplicateIds.length ? 'FAIL' : 'PASS', NO_DUPLICATE_ORDER_CONFLICT: duplicateOrders.length ? 'FAIL' : 'PASS', SALE_1319: comparable(readback) }, null, 2))
    if (rows.length !== 23 || total !== 347000 || duplicateIds.length || duplicateOrders.length) process.exitCode = 1
  } finally { await deleteApp(app) }
}
main().catch(error => fail(error.message || String(error)))
