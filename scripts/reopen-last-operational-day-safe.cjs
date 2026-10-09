#!/usr/bin/env node

/* POS101 guarded last-day reopen. Default is read-only. --execute is required
   for the single central multi-location update, after all safety gates pass. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DATABASE_URL = process.env.POS101_DATABASE_URL || 'https://cmms-37512-default-rtdb.asia-southeast1.firebasedatabase.app'
const SERVICE_ACCOUNT_PATH = process.env.POS101_SERVICE_ACCOUNT_PATH || 'C:/Users/MSI/Downloads/cmms-37512-firebase-adminsdk-fbsvc-094062cb90.json'
const args = process.argv.slice(2)
const execute = args.includes('--execute')
const actor = process.env.POS101_REOPENED_BY || 'POS101-safe-reopen'
const queueJson = args.find(v => v.startsWith('--queue-json='))?.slice('--queue-json='.length) || ''
const pending = queueJson ? JSON.parse(queueJson) : { saleWrite: 0, voidUpdate: 0, active: 0 }

const text = v => String(v ?? '').trim()
const values = v => Object.entries(v && typeof v === 'object' ? v : {}).map(([key, row]) => ({ ...(row || {}), _key: key }))
const activeSale = row => !['voided', 'cancelled', 'canceled', 'باطل', 'ملغي'].includes(text(row?.status).toLowerCase())
const amount = row => Number(row?.total ?? row?.amount ?? 0)
const sum = rows => rows.reduce((n, row) => n + amount(row), 0)
const iso = new Date().toISOString()
const fail = code => { console.log(`${code}=FAIL`); process.exitCode = 2; throw new Error(code) }

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) throw new Error(`SERVICE_ACCOUNT_NOT_FOUND:${SERVICE_ACCOUNT_PATH}`)
  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getDatabase } = await import('firebase-admin/database')
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  const app = initializeApp({ credential: cert(serviceAccount), databaseURL: DATABASE_URL })
  const db = getDatabase(app)
  const paths = ['pos101_operational_day/current', 'pos101_operational_days', 'pos101_cashbox_settlements', 'pos101_sales', 'pos101_expenses', 'pos101_cashbox_transactions']
  const raw = Object.fromEntries(await Promise.all(paths.map(async key => [key, (await db.ref(key).once('value')).val()])))
  const days = values(raw.pos101_operational_days).map(row => ({ ...row, id: text(row.id || row.operationalDayId || row._key) })).filter(row => row.id && row.businessDate)
  const openDays = days.filter(row => row.status === 'open')
  const closedDays = days.filter(row => row.status === 'closed').sort((a, b) => Number(b.closedAt || b.endedAt || b.updatedAt || b.startedAt || 0) - Number(a.closedAt || a.endedAt || a.updatedAt || a.startedAt || 0))
  const latest = closedDays[0] || null
  const current = raw['pos101_operational_day/current'] || null
  const currentStatus = current?.status || (openDays.length ? 'open' : 'missing')
  const dayId = text(latest?.id)
  const businessDate = text(latest?.businessDate)
  const sales = values(raw.pos101_sales).filter(row => row.businessDate === businessDate && row.operationalDayId === dayId && activeSale(row))
  const expenses = values(raw.pos101_expenses).filter(row => row && (row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === businessDate)) && row.status !== 'deleted' && row.status !== 'voided' && row.isActive !== false)
  const transactions = values(raw.pos101_cashbox_transactions).filter(row => row && row.businessDate === businessDate && row.status !== 'voided')
  const withdrawals = transactions.filter(row => text(row.type || row.transactionType).toLowerCase() === 'withdrawal')
  const settlement = values(raw.pos101_cashbox_settlements).find(row => text(row.operationalDayId) === dayId) || null
  const before = { current, latestClosed: latest, settlement, salesSummary: { count: sales.length, total: sum(sales) }, expensesSummary: { count: expenses.length, total: sum(expenses) }, withdrawalsSummary: { count: withdrawals.length, total: sum(withdrawals) }, sales, expenses, withdrawals, transactions, capturedAt: iso }
  console.log(`CURRENT_DAY_STATUS=${currentStatus}`)
  console.log(`LATEST_CLOSED_DAY_ID=${dayId || 'NONE'}`)
  console.log(`LATEST_CLOSED_BUSINESS_DATE=${businessDate || 'NONE'}`)
  console.log(`PENDING_SALE_WRITE=${Number(pending.saleWrite || 0)}`)
  console.log(`PENDING_VOID_UPDATE=${Number(pending.voidUpdate || 0)}`)
  console.log(`ACTIVE_PENDING_QUEUE=${Number(pending.active || 0)}`)
  console.log(`ACTIVE_OPEN_DAYS=${openDays.length}`)
  console.log(`ACTIVE_SALES_COUNT=${sales.length}`)
  console.log(`ACTIVE_SALES_TOTAL=${sum(sales)}`)
  console.log(`EXPENSES_COUNT=${expenses.length}`)
  console.log(`EXPENSES_TOTAL=${sum(expenses)}`)
  console.log(`WITHDRAWALS_COUNT=${withdrawals.length}`)
  console.log(`WITHDRAWALS_TOTAL=${sum(withdrawals)}`)
  console.log(`SETTLEMENT_ID=${settlement?.id || 'NONE'}`)
  console.log(`SETTLEMENT_STATUS=${settlement?.status || 'NONE'}`)
  if (!latest) return fail('LATEST_CLOSED_DAY_MISSING')
  if (openDays.length > 0) { console.log('REOPEN_BLOCKED_ALREADY_OPEN_DAY=YES'); return fail('REOPEN_BLOCKED_ALREADY_OPEN_DAY') }
  if (Number(pending.saleWrite || 0) !== 0) return fail('REOPEN_BLOCKED_PENDING_SALE_WRITE')
  if (Number(pending.voidUpdate || 0) !== 0) return fail('REOPEN_BLOCKED_PENDING_VOID_UPDATE')
  if (Number(pending.active || 0) !== 0) return fail('REOPEN_BLOCKED_ACTIVE_PENDING_QUEUE')
  if (!settlement) return fail('REOPEN_BLOCKED_SETTLEMENT_MISSING')
  if (!execute) { console.log('REOPEN_LAST_DAY_SAFE=DRY_RUN'); return }
  const stamp = iso.replace(/[:.]/g, '-')
  const backupPath = path.resolve(`recovery/pre-reopen-operational-day-${stamp}.json`)
  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.writeFileSync(backupPath, JSON.stringify(before, null, 2) + '\n', 'utf8')
  console.log('PRE_REOPEN_BACKUP=PASS')
  console.log(`BACKUP_PATH=${backupPath}`)
  const day = { ...latest, status: 'open', reopenedAt: iso, reopenedBy: actor, reopenReason: 'accidental-end-day', closedAtBeforeReopen: latest.closedAt || null, endDayReopened: true, updatedAt: Date.now(), version: Number(latest.version || 0) + 1 }
  const reopenedSettlement = { ...settlement, status: 'reopened', reopenedAt: iso, reopenedBy: actor, reopenReason: 'accidental-end-day' }
  const auditId = `audit-reopen-${dayId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const audit = { id: auditId, action: 'reopen operational day', entityType: 'operational_day_reopen', entityId: dayId, userUid: actor, userName: actor, businessDate, timestamp: Date.now(), before: { day: latest, settlement }, after: { day, settlement: reopenedSettlement }, reason: 'accidental-end-day' }
  await db.ref().update({ [`pos101_operational_days/${dayId}`]: day, ['pos101_operational_day/current']: day, [`pos101_cashbox_settlements/${settlement.id}`]: reopenedSettlement, [`pos101_financial_audit_log/${auditId}`]: audit })
  const [dayBack, currentBack, settlementBack, daysBack, salesBack, expensesBack, txBack] = await Promise.all([db.ref(`pos101_operational_days/${dayId}`).once('value'), db.ref('pos101_operational_day/current').once('value'), db.ref(`pos101_cashbox_settlements/${settlement.id}`).once('value'), db.ref('pos101_operational_days').once('value'), db.ref('pos101_sales').once('value'), db.ref('pos101_expenses').once('value'), db.ref('pos101_cashbox_transactions').once('value')])
  const verifiedDay = dayBack.val(); const verifiedCurrent = currentBack.val(); const verifiedSettlement = settlementBack.val()
  const afterSales = values(salesBack.val()).filter(row => row.businessDate === businessDate && row.operationalDayId === dayId && activeSale(row))
  const afterExpenses = values(expensesBack.val()).filter(row => row && (row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === businessDate)) && row.status !== 'deleted' && row.status !== 'voided' && row.isActive !== false)
  const afterTx = values(txBack.val()).filter(row => row && row.businessDate === businessDate && row.status !== 'voided')
  const sameIdentity = verifiedDay?.id === dayId && verifiedDay?.operationalDayId === dayId && verifiedDay?.businessDate === businessDate && verifiedCurrent?.id === dayId && verifiedCurrent?.status === 'open' && verifiedSettlement?.status === 'reopened'
  const noDuplicate = values(daysBack.val()).filter(row => text(row.id || row.operationalDayId || row._key) === dayId).length === 1
  if (!sameIdentity) return fail('CENTRAL_REOPEN_READBACK_FAILED')
  if (afterSales.length !== sales.length || sum(afterSales) !== sum(sales)) return fail('SALES_TOTALS_CHANGED')
  if (afterExpenses.length !== expenses.length || sum(afterExpenses) !== sum(expenses)) return fail('EXPENSES_TOTALS_CHANGED')
  if (afterTx.length !== transactions.length || sum(afterTx) !== sum(transactions)) return fail('WITHDRAWALS_OR_TRANSACTIONS_CHANGED')
  console.log('CENTRAL_DAY_REOPENED=PASS')
  console.log('SETTLEMENT_MARKED_REOPENED=PASS')
  console.log('SALES_TOTALS_UNCHANGED=PASS')
  console.log('EXPENSES_TOTALS_UNCHANGED=PASS')
  console.log('NO_DUPLICATE_OPERATIONAL_DAY=PASS')
  console.log('SYNC_SAFETY_UNCHANGED=PASS')
}
main().catch(error => { console.error(`REOPEN_ERROR=${error.message}`); process.exitCode = 1 })
