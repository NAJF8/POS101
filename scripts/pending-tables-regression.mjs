import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const panel = read('src/components/OrderPanel.jsx')
const service = read('src/services/posCentralSync.js')
const page = read('src/components/PendingTables.jsx')
const createDialog = read('src/components/SavePendingTableDialog.jsx')
const operationalDay = read('src/components/OperationalDay.jsx')
const rules = JSON.parse(read('database.rules.json'))

const checks = [
  ['PENDING_TABLE_CREATE', service.includes('pos101_pending_tables') && service.includes('export const savePendingTable')],
  ['CUSTOMER_NAME_REQUIRED', service.includes('CUSTOMER_NAME_REQUIRED') && createDialog.includes('اسم الزبون مطلوب')],
  ['PENDING_TABLES_SECTION_EXISTS', app.includes("currentView === 'pending-tables'") && page.includes('الطاولات المعلقة')],
  ['PENDING_TABLES_REALTIME_SYNC', service.includes('export const subscribePendingTables') && service.includes('onValue(pendingTablesRef()')],
  ['PENDING_TABLE_NOT_IN_SALES', service.includes('Pending tables are a separate operational ledger') && !service.includes('enqueueSale(payload)')],
  ['PENDING_TABLE_NOT_IN_END_DAY_TOTALS', service.includes('pendingTableId') && service.includes("source: 'pending_table'")],
  ['END_DAY_ALLOWED_WITH_PENDING_TABLES', operationalDay.includes('سيتم إبقاؤها في قسم الطاولات المعلقة ولا تُحسب ضمن المبيعات')],
  ['PAY_PENDING_TABLE_TO_SALE', service.includes('export const payPendingTable') && service.includes('pos101_sales/${saleId}')],
  ['CENTRAL_ORDER_NUMBER_ON_PAYMENT', service.indexOf('payPendingTable') < service.indexOf('allocateCentralOrderNumber', service.indexOf('payPendingTable'))],
  ['PAYMENT_READBACK', service.includes('PENDING_TABLE_PAYMENT_READBACK_FAILED')],
  ['NO_DUPLICATE_SALE_FROM_PENDING_TABLE', service.includes('duplicate: true') && service.includes('linkedSaleId')],
  ['PENDING_TABLE_MARKED_PAID', service.includes("status: 'paid'") && service.includes('paidAt')],
  ['LINKED_SALE_ID_SAVED', service.includes('linkedSaleId: saleId')],
  ['PENDING_TABLE_EDIT', service.includes('export const updatePendingTable') && page.includes('تعديل')],
  ['PENDING_TABLE_CANCEL_WITH_AUDIT', service.includes('pending_table_${status}') && service.includes('PENDING_TABLE_REASON_REQUIRED') && page.includes('إلغاء')],
  ['PENDING_TABLE_UNPAID_LOST_WITH_AUDIT', service.includes('unpaid_lost') && page.includes('غير مدفوعة / دين')],
  ['PENDING_TABLE_REPORT', page.includes('تقرير الطاولات المعلقة') && page.includes('linkedSaleId')],
  ['NO_ACCOUNTING_REGRESSION', !service.includes('pos101_pending_tables') || !service.includes('pos101_cashbox_transactions/${')],
  ['RULES_SEPARATE_PATH', Boolean(rules.rules.pos101_pending_tables)],
  ['BUILD_WIRING', app.includes('SavePendingTableDialog') && panel.includes('onSavePending')],
]
for (const [name, ok] of checks) {
  assert.equal(ok, true, `${name}=FAIL`)
  console.log(`${name}=PASS`)
}
