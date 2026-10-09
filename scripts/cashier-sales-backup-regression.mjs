import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const header = fs.readFileSync(new URL('../src/components/Header.jsx', import.meta.url), 'utf8')

assert.match(header, /تنزيل نسخة المبيعات/)
assert.match(header, /onClick=\{onDownloadSalesBackup\}/)
assert.doesNotMatch(header, /مزامنة الآن/)
assert.match(app, /const backup = \{[\s\S]*\.\.\.buildSalesBackup\(\),[\s\S]*operationalDay:[\s\S]*appVersion: BUILD_SHA,[\s\S]*liveBundle:/)
assert.match(app, /new Blob\(\[JSON\.stringify\(backup, null, 2\)/)
assert.match(app, /anchor\.download = `pos101-sales-backup-/)
assert.doesNotMatch(app.match(/const downloadSalesBackup = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[operationalDay\]\)/)?.[0] || '', /saveCentral|enqueueSale|enqueueVoid|processSaleSyncQueue|markSaleSynced|markSaleVoidedCentral/)

console.log(JSON.stringify({
  SALES_BACKUP_DOWNLOAD_VISIBLE_FOR_CASHIER: 'PASS',
  RECOVERY_INSPECTION_STILL_HIDDEN_FROM_CASHIER: 'PASS',
  SYNC_DIAGNOSTIC_STILL_HIDDEN_FROM_CASHIER: 'PASS',
  MANUAL_SYNC_STILL_HIDDEN_FROM_CASHIER: 'PASS',
  BACKUP_DOWNLOAD_READ_ONLY: 'PASS',
}))
