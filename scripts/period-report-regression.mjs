import assert from 'node:assert/strict'
import fs from 'node:fs'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from '../src/services/periodReport.js'

const rows = [
  { id: '27', businessDate: '2026-09-27', createdAt: '2026-10-05T12:00:00+03:00' },
  { id: '28', businessDate: '2026-09-28' },
  { id: '26', businessDate: '2026-09-26' },
]
assert.deepEqual(filterRowsByBusinessDate(rows, '2026-09-27', '2026-10-03').map(row => row.id), ['27', '28'])
assert.equal(filterRowsByBusinessDate(rows, '2026-09-27', '2026-10-05').length, 2)
assert.equal(filterRowsByBusinessDate(rows, '2026-10-05', '2026-09-27').length, 0)
assert.equal(isValidDateRange('2026-09-27', '2026-10-03'), true)
assert.equal(isValidDateRange('2026-10-03', '2026-09-27'), false)
assert.equal(businessDateOf(rows[0]), '2026-09-27')
const source = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(source, /طباعة تقرير الفترة/)
assert.match(source, /filterRowsByBusinessDate/)
assert.match(source, /periodDataset\.daily/)
console.log('PERIOD_REPORT_REGRESSION=PASS')
