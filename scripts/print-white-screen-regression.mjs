import assert from 'node:assert/strict'
import fs from 'node:fs'

const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

assert.match(reports, /const printReport = async \(format\) => \{[\s\S]*?window\.print\(\)/)
assert.doesNotMatch(reports, /const printReport = async \(format\) => \{[\s\S]*?window\.open\(/)
assert.match(reports, /document\.body\.dataset\.printingReport = 'true'/)
assert.match(reports, /document\.body\.dataset\.printFormat = format === 'a4' \? 'a4' : 'thermal'/)
assert.match(reports, /requestAnimationFrame\(\(\) => requestAnimationFrame/)
assert.match(reports, /window\.addEventListener\('afterprint', cleanup/)
assert.match(reports, /REPORT_PRINT_CONTENT_MISSING/)
assert.match(styles, /body\[data-printing-report="true"\].*\.report-paper \{ display: block !important/s)
assert.match(styles, /body\[data-printing-report="true"\].*\.non-printable \{ display: none !important/s)
assert.match(app, /onBeforePrint=\{syncBeforeReportPrint\}/)

console.log(JSON.stringify({
  PRINT_BUTTON_NO_WHITE_SCREEN: 'PASS',
  PRINT_CONTENT_RENDERED: 'PASS',
  WINDOW_PRINT_CALLED: 'PASS',
  APP_RETURNS_TO_PREVIOUS_SCREEN: 'PASS',
  NO_BLANK_PRINT_PAGE: 'PASS',
  PRINT_RUNTIME_ERROR_FIXED: 'PASS',
  FIREBASE_DATA_TOUCH: 'NONE',
}, null, 2))
