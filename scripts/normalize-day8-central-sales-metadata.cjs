#!/usr/bin/env node

/*
 * One-time, metadata-only repair for the verified Day8 central sales.
 * The script refuses to write unless the exact active set and its identity,
 * date, totals, payment, and duplicate checks pass first.
 */

const fs = require('node:fs')
const path = require('node:path')

const BUSINESS_DATE = '2026-10-08'
const DATABASE_URL = 'https://cmms-37512-default-rtdb.asia-southeast1.firebasedatabase.app'
const SALES_PATH = 'pos101_sales'
const EXPECTED_COUNT = 23
const EXECUTE = process.argv.includes('--execute')
const INVALID_STATUSES = new Set(['voided', 'cancelled', 'canceled', 'abandoned', 'draft', 'باطل', 'ملغي'])
const ALLOWED_METADATA_FIELDS = new Set(['syncStatus', 'centralVerified', 'centralVerifiedAt', 'centralVerificationNote', 'previousSyncStatus'])

const text = value => String(value ?? '').trim()
const saleIdOf = (sale, key) => text(sale?.saleId || sale?.id || key)
const statusOf = sale => text(sale?.status).toLowerCase()
const isActive = sale => !INVALID_STATUSES.has(statusOf(sale)) && sale?.voided !== true && sale?.cancelled !== true
const amount = value => Number(value)
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function findServiceAccount() {
  const configured = process.env.POS101_SERVICE_ACCOUNT_PATH
  if (configured) return path.resolve(configured)
  const directory = 'C:/Users/MSI/Downloads'
  const names = fs.readdirSync(directory).filter(name => /^cmms-37512-firebase-adminsdk-.*\.json$/i.test(name))
  if (names.length !== 1) throw new Error(`SERVICE_ACCOUNT_EXPECTED_ONE_FOUND_${names.length}`)
  return path.join(directory, names[0])
}

function protectedRecord(sale, key) {
  const clone = JSON.parse(JSON.stringify(sale || {}))
  for (const field of ALLOWED_METADATA_FIELDS) delete clone[field]
  return { key, value: clone }
}

function validateActiveRows(allRows) {
  const activeRows = allRows.filter(({ sale }) => text(sale.businessDate) === BUSINESS_DATE && isActive(sale))
  const invalidRows = allRows.filter(({ sale }) => text(sale.businessDate) === BUSINESS_DATE && !isActive(sale))
  if (activeRows.length !== EXPECTED_COUNT) throw new Error(`ACTIVE_DAY8_COUNT_EXPECTED_${EXPECTED_COUNT}_FOUND_${activeRows.length}`)

  const badIdentity = activeRows.filter(({ key, sale }) => saleIdOf(sale, key) !== key || !sale.saleId && !sale.id)
  if (badIdentity.length) throw new Error(`SALE_ID_KEY_MISMATCH_${badIdentity.length}`)
  const missingRequired = activeRows.filter(({ sale }) => !text(sale.businessDate) || text(sale.businessDate) !== BUSINESS_DATE || !Number.isFinite(amount(sale.total)) || !text(sale.operationalDayId))
  if (missingRequired.length) throw new Error(`REQUIRED_SALE_FIELDS_MISSING_${missingRequired.length}`)

  const saleIds = activeRows.map(({ key, sale }) => saleIdOf(sale, key))
  const duplicateSaleIds = saleIds.filter((id, index) => saleIds.indexOf(id) !== index)
  if (duplicateSaleIds.length) throw new Error(`DUPLICATE_ACTIVE_SALE_ID_${[...new Set(duplicateSaleIds)].join(',')}`)
  const orderKeys = activeRows.map(({ sale }) => `${text(sale.operationalDayId)}|${text(sale.orderNumber)}`)
  const duplicateOrderKeys = orderKeys.filter((value, index) => orderKeys.indexOf(value) !== index)
  if (duplicateOrderKeys.length) throw new Error(`DUPLICATE_ACTIVE_ORDER_NUMBER_${[...new Set(duplicateOrderKeys)].join(',')}`)

  return { activeRows, invalidRows }
}

function assertFinancialReadback(beforeRows, afterRows) {
  if (beforeRows.length !== afterRows.length) throw new Error('FINANCIAL_READBACK_COUNT_CHANGED')
  const afterByKey = new Map(afterRows.map(row => [row.key, row.sale]))
  for (const before of beforeRows) {
    const after = afterByKey.get(before.key)
    if (!after || stable(protectedRecord(before.sale, before.key).value) !== stable(protectedRecord(after, before.key).value)) throw new Error(`PROTECTED_RECORD_CHANGED_${before.key}`)
  }
  const beforeTotal = beforeRows.reduce((sum, row) => sum + amount(row.sale.total), 0)
  const afterTotal = afterRows.reduce((sum, row) => sum + amount(row.sale.total), 0)
  if (beforeTotal !== afterTotal) throw new Error('FINANCIAL_TOTAL_CHANGED')
}

async function main() {
  const recoveryDirectory = path.resolve('recovery')
  fs.mkdirSync(recoveryDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[T:.Z]/g, '-').replace(/-+$/, '')
  const backupPath = path.join(recoveryDirectory, `day8-central-sales-metadata-backup-${timestamp}.json`)
  const { initializeApp, cert, deleteApp } = await import('firebase-admin/app')
  const { getDatabase } = await import('firebase-admin/database')
  const app = initializeApp({ credential: cert(readJson(findServiceAccount())), databaseURL: DATABASE_URL })
  const db = getDatabase(app)

  try {
    const beforeSnapshot = await db.ref(SALES_PATH).once('value')
    const raw = beforeSnapshot.val()
    if (!raw || typeof raw !== 'object') throw new Error('CANONICAL_SALES_PATH_EMPTY_OR_INVALID')
    const allRows = Object.entries(raw).map(([key, sale]) => ({ key, sale: sale || {} }))
    const { activeRows, invalidRows } = validateActiveRows(allRows)
    const pendingRows = activeRows.filter(({ sale }) => sale.syncStatus === 'pending' || sale.centralVerified !== true)
    if (pendingRows.length !== EXPECTED_COUNT) throw new Error(`CENTRAL_PENDING_METADATA_EXPECTED_${EXPECTED_COUNT}_FOUND_${pendingRows.length}`)

    const backup = {
      createdAt: new Date().toISOString(),
      businessDate: BUSINESS_DATE,
      sourcePath: SALES_PATH,
      recordCount: activeRows.length,
      records: activeRows,
    }
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2) + '\n', 'utf8')

    const financialBefore = activeRows.map(row => ({ key: row.key, sale: JSON.parse(JSON.stringify(row.sale)) }))
    const verificationTime = new Date().toISOString()
    if (EXECUTE) {
      const updates = {}
      for (const { key, sale } of pendingRows) {
        updates[`${SALES_PATH}/${key}/syncStatus`] = 'synced'
        updates[`${SALES_PATH}/${key}/centralVerified`] = true
        updates[`${SALES_PATH}/${key}/centralVerifiedAt`] = verificationTime
        updates[`${SALES_PATH}/${key}/previousSyncStatus`] = sale.syncStatus ?? null
      }
      await db.ref().update(updates)
    }

    const afterSnapshot = await db.ref(SALES_PATH).once('value')
    const afterRaw = afterSnapshot.val()
    const afterRows = Object.entries(afterRaw || {}).filter(([, sale]) => text(sale.businessDate) === BUSINESS_DATE && isActive(sale)).map(([key, sale]) => ({ key, sale: sale || {} }))
    assertFinancialReadback(financialBefore, afterRows)
    const metadataPass = EXECUTE && afterRows.length === EXPECTED_COUNT && afterRows.every(({ sale }) => sale.syncStatus === 'synced' && sale.centralVerified === true && typeof sale.centralVerifiedAt === 'string')

    console.log(`CENTRAL_PENDING_METADATA_FOUND=${pendingRows.length === EXPECTED_COUNT ? '23' : pendingRows.length}`)
    console.log('CENTRAL_PENDING_METADATA_BACKUP=PASS')
    console.log(`CENTRAL_PENDING_METADATA_NORMALIZED=${metadataPass ? 'PASS' : 'NOT_EXECUTED'}`)
    console.log(`CENTRAL_VERIFIED_READBACK=${metadataPass ? 'PASS' : 'NOT_EXECUTED'}`)
    console.log('FINANCIAL_FIELDS_UNCHANGED=PASS')
    console.log('NO_DUPLICATE_SALE=PASS')
    console.log(`VOIDED_CANCELLED_EXCLUDED=${invalidRows.every(({ sale }) => !isActive(sale)) ? 'PASS' : 'FAIL'}`)
    console.log(`CENTRAL_METADATA_BACKUP_PATH=${backupPath}`)
    if (!metadataPass) process.exitCode = 2
  } finally {
    await deleteApp(app)
  }
}

main().catch(error => { console.error(`CENTRAL_METADATA_NORMALIZATION=FAIL\n${error.message}`); process.exitCode = 1 })
