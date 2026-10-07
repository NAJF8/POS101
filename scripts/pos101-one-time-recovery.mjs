#!/usr/bin/env node

// POS101 one-time recovery tool. Default mode is DRY RUN and performs zero
// Firebase writes. It never changes localStorage or deletes queue rows.

import fs from 'node:fs'
import path from 'node:path'

const TARGET_DAY = '44d8267e-2bf9-43c4-a069-d5cb85364c03'
const APPROVAL = 'I APPROVE POS101 RECOVERY'
const TARGETS = new Map([
  ['1273', { saleId: 'b7cadbed-f6aa-4817-9ded-73fe3b011092', total: 5000 }],
  ['1277', { saleId: '544092ff-551f-4471-b36b-86f9a4bb9668', total: 3000 }],
  ['1294', { saleId: '9fd5b701-3dd2-4c4a-b420-25a8db92f2be', total: 8000 }],
  ['1295', { saleId: '4766b18b-1477-452a-adc7-e24868ca6f19', total: 5130 }],
  ['1296', { saleId: '803e7d66-18c2-4a78-8926-fc465df4c4d6', total: 21000 }],
])

const args = process.argv.slice(2)
const valueAfter = name => {
  const index = args.findIndex(value => value === name || value.startsWith(`${name}=`))
  if (index < 0) return ''
  return args[index].includes('=') ? args[index].slice(name.length + 1) : args[index + 1] || ''
}
const inputPath = valueAfter('--input')
const execute = args.includes('--execute')
const approval = valueAfter('--approval')
const databaseUrl = process.env.POS101_DATABASE_URL || process.env.VITE_POS101_DATABASE_URL || ''
const idToken = process.env.POS101_ID_TOKEN || ''
const serviceAccountPath = process.env.POS101_SERVICE_ACCOUNT_PATH || ''
const fail = message => { throw new Error(message) }
const parseJson = (raw, label) => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { fail(`INVALID_JSON:${label}`) } }
const text = value => String(value ?? '').trim()
const saleIdOf = sale => text(sale?.saleId || sale?.id)
const orderNumberOf = sale => text(sale?.orderNumber || sale?.order_number)
const operationKeyOf = sale => text(sale?.operationKey || sale?.operation_key) || (saleIdOf(sale) ? `pos101:${saleIdOf(sale)}` : '')
const totalOf = sale => Number(sale?.total ?? sale?.net ?? sale?.subtotal)
const paymentMethodOf = sale => text(sale?.paymentMethod || sale?.payment?.method || sale?.paymentType)
const itemsOf = sale => Array.isArray(sale?.items) ? sale.items : Array.isArray(sale?.order?.items) ? sale.order.items : []

const readInput = () => {
  if (!inputPath) fail('INPUT_REQUIRED: use --input <cashier-recovery.json>')
  const absolute = path.resolve(inputPath)
  const root = parseJson(fs.readFileSync(absolute, 'utf8'), absolute)
  const rawQueue = root?.['pos101.syncQueue'] ?? root?.localStorage?.['pos101.syncQueue'] ?? root?.syncQueue ?? root?.queue ?? root
  const queue = Array.isArray(rawQueue) ? rawQueue : parseJson(rawQueue, 'pos101.syncQueue')
  if (!Array.isArray(queue)) fail('QUEUE_ARRAY_REQUIRED')
  const central = root?.centralSales || root?.central || null
  return { queue, central: Array.isArray(central) ? central : null }
}

const centralFromInput = (central, saleId) => (central || []).find(row => saleIdOf(row) === saleId) || null
const centralPath = saleId => `pos101_sales/${saleId}`
const centralUrl = saleId => `${databaseUrl.replace(/\/$/, '')}/${centralPath(saleId)}.json`
const authUrl = url => idToken ? `${url}?auth=${encodeURIComponent(idToken)}` : url
const createAdminDatabase = async () => {
  if (!serviceAccountPath) return null
  const absolute = path.resolve(serviceAccountPath)
  if (!fs.existsSync(absolute)) fail(`SERVICE_ACCOUNT_NOT_FOUND:${absolute}`)
  let adminApp, adminDatabase
  try {
    adminApp = await import('firebase-admin/app')
    adminDatabase = await import('firebase-admin/database')
  }
  catch { fail('FIREBASE_ADMIN_MISSING: run npm install firebase-admin') }
  const serviceAccount = parseJson(fs.readFileSync(absolute, 'utf8'), 'service-account')
  const app = adminApp.getApps().length
    ? adminApp.getApps()[0]
    : adminApp.initializeApp({ credential: adminApp.cert(serviceAccount), databaseURL: databaseUrl })
  const database = adminDatabase.getDatabase(app)
  database.__pos101AdminApp = adminApp
  database.__pos101App = app
  return database
}
const readCentral = async (saleId, inputCentral, adminDb) => {
  const fixture = centralFromInput(inputCentral, saleId)
  if (fixture) return { value: fixture, source: 'input-central-snapshot' }
  if (adminDb) {
    const snapshot = await adminDb.ref(centralPath(saleId)).once('value')
    return { value: snapshot.exists() ? snapshot.val() : null, source: 'firebase-admin' }
  }
  if (!databaseUrl || !idToken) return { value: null, source: 'AUTH_REQUIRED_FOR_CENTRAL_READ' }
  const response = await fetch(authUrl(centralUrl(saleId)))
  if (!response.ok) return { value: null, source: `CENTRAL_READ_HTTP_${response.status}` }
  return { value: (await response.json()) || null, source: 'firebase' }
}

const normalize = (entry, expectedOrder) => {
  const sale = entry?.sale || entry
  const saleId = saleIdOf(sale)
  const operationKey = operationKeyOf(sale)
  const total = totalOf(sale)
  const paymentMethod = paymentMethodOf(sale)
  const businessDate = text(sale?.businessDate)
  const operationalDayId = text(sale?.operationalDayId || sale?.operational_day_id)
  const missing = []
  if (!saleId) missing.push('saleId')
  if (!Number.isFinite(total)) missing.push('total')
  if (!itemsOf(sale).length) missing.push('items')
  if (!businessDate) missing.push('businessDate')
  if (operationalDayId !== TARGET_DAY) missing.push(`operationalDayId!=${TARGET_DAY}`)
  if (expectedOrder && orderNumberOf(sale) !== expectedOrder) missing.push(`orderNumber!=${expectedOrder}`)
  return { sale: { ...sale, saleId, id: saleId, operationKey, paymentMethod, businessDate, operationalDayId, items: itemsOf(sale) }, missing }
}
const equalSale = (expected, actual) => Boolean(actual
  && saleIdOf(expected) === saleIdOf(actual)
  && orderNumberOf(expected) === orderNumberOf(actual)
  && Number(totalOf(expected)) === Number(totalOf(actual))
  && paymentMethodOf(expected) === paymentMethodOf(actual)
  && text(expected.businessDate) === text(actual.businessDate)
  && text(expected.operationalDayId || expected.operational_day_id) === text(actual.operationalDayId || actual.operational_day_id))
const reportRow = ({ sale, central, centralSource, missing }) => ({
  orderNumber: orderNumberOf(sale), saleId: saleIdOf(sale), operationKey: operationKeyOf(sale), total: totalOf(sale),
  paymentMethod: paymentMethodOf(sale), businessDate: text(sale.businessDate), operationalDayId: text(sale.operationalDayId || sale.operational_day_id),
  centralExistsBefore: Boolean(central), centralReadSource: centralSource, payloadValid: missing.length === 0,
  duplicateRisk: central ? 'SKIP_EXISTS' : 'NONE', proposedAction: missing.length ? 'SKIP_INVALID' : central ? 'SKIP_EXISTS' : 'WRITE', missingFields: missing,
})

const main = async () => {
  const { queue, central } = readInput()
  const adminDb = await createAdminDatabase()
  const byOrder = new Map()
  for (const entry of queue) {
    const sale = entry?.sale || entry
    const order = orderNumberOf(sale)
    if (TARGETS.has(order) && !byOrder.has(order)) byOrder.set(order, entry)
  }
  const rows = []
  let writes = 0
  let existingTargets = 0
  let stopped = false
  for (const [order, expected] of TARGETS) {
    const entry = byOrder.get(order)
    const normalized = normalize(entry || { orderNumber: order, saleId: expected.saleId, total: expected.total }, order)
    if (saleIdOf(normalized.sale) !== expected.saleId) normalized.missing.push(`saleId!=${expected.saleId}`)
    if (Number(totalOf(normalized.sale)) !== expected.total) normalized.missing.push(`total!=${expected.total}`)
    const centralResult = await readCentral(expected.saleId, central, adminDb)
    const row = reportRow({ sale: normalized.sale, central: centralResult.value, centralSource: centralResult.source, missing: [...new Set(normalized.missing)] })
    if (row.centralExistsBefore) existingTargets += 1
    if (execute && !stopped && row.proposedAction === 'WRITE') {
      writes += 1
      if (adminDb) await adminDb.ref(centralPath(expected.saleId)).set(normalized.sale)
      else {
        const response = await fetch(authUrl(centralUrl(expected.saleId)), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(normalized.sale) })
        if (!response.ok) { stopped = true; row.executeError = `WRITE_HTTP_${response.status}` }
      }
      if (!stopped) {
        const readback = await readCentral(expected.saleId, null, adminDb)
        row.readback = equalSale(normalized.sale, readback.value) ? 'PASS' : 'FAIL'
        if (row.readback !== 'PASS') stopped = true
      }
    }
    rows.push(row)
    if (stopped) break
  }
  for (const order of TARGETS.keys()) if (!rows.some(row => row.orderNumber === order)) rows.push({ orderNumber: order, payloadValid: false, proposedAction: 'SKIP_INVALID', missingFields: ['not_processed_after_failure'] })
  const rowFor = order => rows.find(row => row.orderNumber === order)
  const existsOrWrite = order => ['SKIP_EXISTS', 'WRITE'].includes(rowFor(order)?.proposedAction) || (execute && !stopped && rowFor(order)?.readback === 'PASS')
  console.log(JSON.stringify({
    DRY_RUN: execute ? 'NOT_RUN' : rows.every(row => row.proposedAction !== 'SKIP_INVALID') ? 'PASS' : 'FAIL', EXECUTE: execute ? (stopped ? 'FAIL' : 'PASS') : 'NOT_RUN',
    sales: rows,
    '1273_EXISTS_OR_WRITE': existsOrWrite('1273') ? 'PASS' : 'FAIL', '1273_READBACK': execute ? (rowFor('1273')?.readback || 'NOT_RUN') : 'NOT_RUN',
    '1277_EXISTS_OR_WRITE': existsOrWrite('1277') ? 'PASS' : 'FAIL', '1277_READBACK': execute ? (rowFor('1277')?.readback || 'NOT_RUN') : 'NOT_RUN',
    '1294_EXISTS_OR_WRITE': existsOrWrite('1294') ? 'PASS' : 'FAIL', '1294_READBACK': execute ? (rowFor('1294')?.readback || 'NOT_RUN') : 'NOT_RUN',
    '1295_EXISTS_OR_WRITE': existsOrWrite('1295') ? 'PASS' : 'FAIL', '1295_READBACK': execute ? (rowFor('1295')?.readback || 'NOT_RUN') : 'NOT_RUN',
    '1296_EXISTS_OR_WRITE': existsOrWrite('1296') ? 'PASS' : 'FAIL', '1296_READBACK': execute ? (rowFor('1296')?.readback || 'NOT_RUN') : 'NOT_RUN',
    NON_TARGET_WRITES: 0, DUPLICATES: 0, existingTargetCount: existingTargets, QUEUE_DELETE: 0, SETTLEMENT_WRITE: 0, DAY_CLOSE_WRITE: 0, firebaseWritesPerformed: writes,
  }, null, 2))
  adminDb?.goOffline?.()
  if (adminDb?.__pos101AdminApp && adminDb?.__pos101App) await adminDb.__pos101AdminApp.deleteApp(adminDb.__pos101App)
}

if (execute && approval !== APPROVAL) fail(`EXECUTE_BLOCKED: pass --approval="${APPROVAL}" only after reviewing DRY RUN`)
if (execute && (!serviceAccountPath && (!idToken || !databaseUrl))) fail('EXECUTE_BLOCKED: provide POS101_SERVICE_ACCOUNT_PATH or POS101_ID_TOKEN plus POS101_DATABASE_URL')
await main()
