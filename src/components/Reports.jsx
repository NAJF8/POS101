import React, { useEffect, useState, useMemo, useRef } from 'react'
import { Icon } from './Icons'
import { logoDataUri } from '../assets/logo'

import { formatMoney, formatDateTime, formatTime, formatNumber } from '../utils.js'
import { readLocalSales, numberValue } from '../services/reportSales'
import { calculateComprehensiveSummary } from '../services/comprehensiveReport'
import { normalizeExpense, sumExpenses } from '../services/expenseReporting.js'
import { calculateCashboxBalance } from '../services/financialCenter.js'
import { readCentralExpensesForReports, readLocalExpenses } from '../services/posCentralSync.js'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from '../services/periodReport.js'
import { buildMaterialsReport } from '../services/materialsReport.js'

const EMPTY_PERIOD_DATASET = { valid: false, sales: [], expenses: [], transactions: [], daily: [], employees: [], summary: { grossSales: 0, cashSales: 0, electronicSales: 0, expensesTotal: 0, withdrawals: 0, deposits: 0, adjustments: 0, orderCount: 0, averageOrder: 0, netCash: 0, beforeBalance: 0, endBalance: 0 } }
const format = formatMoney
// Reports print in their own A4 or thermal 80mm document. Thermal content is
// intentionally narrower than the Windows driver's confirmed 72.1mm limit.
const logoUrl = logoDataUri || `${import.meta.env.BASE_URL}assets/branding/101-logo-transparent.png`

const formatDate = value => formatDateTime(value)

const toDateInputValue = value => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = part => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const getDefaultReportDate = () => toDateInputValue(new Date())
const getBaghdadDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const shiftDate = (dateText, days) => { const date = new Date(`${dateText}T12:00:00+03:00`); date.setDate(date.getDate() + days); return getBaghdadDate(date) }

const a4PrintStyles = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif; }
  body { direction: rtl; font-size: 12pt; line-height: 1.5; }
  .report-paper { width: 100%; max-width: none; margin: 0; padding: 0; background: #fff; }
  .report-paper-header { text-align: center; padding-bottom: 6mm; margin-bottom: 7mm; border-bottom: .4mm solid #40533b; }
  .materials-brand { margin-bottom: 1mm; font-size: 15pt; font-weight: 900; letter-spacing: .2mm; }
  .report-logo { display: block; width: 40mm; height: 29mm; object-fit: contain; margin: 0 auto 3mm; filter: brightness(0); }
  h2 { margin: 0 0 2mm; font-size: 20pt; color: #000; }
  h3 { margin: 7mm 0 3mm; font-size: 15pt; color: #000; }
  p { margin: 0; }
  .print-table { width: 100%; border-collapse: collapse; margin: 0 0 6mm; }
  .print-table th, .print-table td { border: .35mm solid #000; padding: 2.8mm; color: #000; text-align: right; vertical-align: top; }
  .print-table th { background: #fff; color: #000; font-weight: 800; }
  .print-table tfoot td { background: #fff; color: #000; font-weight: 800; }
  .summary-row td, .summary-highlight td { font-weight: 900; }
  .materials-section { break-inside: auto; page-break-inside: auto; }
  .materials-section h3 { break-after: avoid; page-break-after: avoid; }
  .number-cell { direction: ltr; text-align: left; white-space: nowrap; }
  .report-paper-footer { display: flex; justify-content: space-between; gap: 6mm; padding-top: 4mm; margin-top: 7mm; border-top: .35mm solid #000; color: #000; font-weight: 800; }
  thead { display: table-header-group; }
  tr, .report-paper-header, .report-paper-footer { break-inside: avoid; page-break-inside: avoid; }
`

// Match the thermal receipt's 80mm paper settings. Content stays below the
// driver's confirmed 72.1mm printable limit. This is injected
// into the isolated print window only for the comprehensive report.
const thermalComprehensiveStyles = `
  @page { margin: 0; size: 80mm auto; }
  * { box-sizing: border-box; }
  html, body { width: 100% !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; position: static !important; background: #fff; color: #000; }
  body { direction: rtl; unicode-bidi: plaintext; font-family: Tahoma, 'Arial Unicode MS', Arial, sans-serif; font-size: 10.5pt; font-weight: 600; line-height: 1.3; }
  .report-paper { display: block; direction: rtl; width: 70mm; max-width: 70mm; min-width: 0; margin: 0 auto; padding: 1.5mm 0 4mm; background: #fff; color: #000; box-sizing: border-box; overflow: visible; }
  .report-paper-header { text-align: center; padding: 0 0 1.5mm; margin: 0 0 1.5mm; border-bottom: .35mm solid #000; color: #000; break-inside: avoid; page-break-inside: avoid; }
  .report-logo { display: block; width: 24mm; height: 24mm; max-width: 100%; object-fit: contain; margin: 0 auto 1.5mm; filter: brightness(0); }
  h2 { margin: 0 0 1.5mm; color: #000; font-size: 16pt; font-weight: 800; line-height: 1.2; }
  h3 { margin: 2.5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: .3mm solid #000; color: #000; font-size: 12.5pt; font-weight: 800; break-after: avoid; page-break-after: avoid; }
  p { margin: 0; color: #000; }
  .report-paper-header > p { font-size: 9.5pt; font-weight: 700; }
  .print-table { width: 100%; max-width: 100%; min-width: 0; margin: 0 0 3mm; border: .35mm solid #000; border-collapse: collapse; color: #000; table-layout: fixed; }
  .print-table th, .print-table td { border: .3mm solid #000; padding: 1.5mm 1mm; color: #000; text-align: center; vertical-align: middle; font-size: 9.5pt; font-weight: 600; overflow-wrap: anywhere; word-break: break-word; }
  .print-table th { font-weight: 800; }
  .print-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .print-table td:first-child { font-weight: 800; }
  .print-table .number-cell { direction: ltr; text-align: left; unicode-bidi: isolate; white-space: nowrap; }
  .report-summary td:first-child { direction: rtl; text-align: right; unicode-bidi: plaintext; }
  .report-summary { break-inside: avoid; page-break-inside: avoid; }
  .summary-highlight td, tr.summary-highlight td { font-size: 12pt !important; font-weight: 900 !important; border-top: .6mm solid #000 !important; border-bottom: .6mm solid #000 !important; }
  .summary-negative td, tr.summary-negative td { font-size: 11pt !important; font-weight: 900 !important; border-top: .4mm solid #000 !important; }
  .summary-row td, tr.summary-row td { font-weight: 900 !important; border-top: .4mm solid #000 !important; }
  .materials-section { break-inside: auto; page-break-inside: auto; }
  .materials-section h3 { break-after: avoid; page-break-after: avoid; }

  .thermal-cards-list { display: flex; flex-direction: column; gap: 2mm; min-width: 0; margin-bottom: 3mm; }
  .thermal-sale-card { display: flex; flex-direction: column; min-width: 0; max-width: 100%; border: .35mm solid #000; padding: 1.5mm; break-inside: avoid; page-break-inside: avoid; }
  .thermal-card-head { display: flex; min-width: 0; gap: 2mm; justify-content: space-between; align-items: baseline; border-bottom: .2mm dashed #555; padding-bottom: 1mm; margin-bottom: 1mm; }
  .thermal-card-head .order-no { min-width: 0; max-width: 50%; font-size: 10pt; font-weight: 800; color: #000; overflow-wrap: anywhere; }
  .thermal-card-head .order-dt { min-width: 0; font-size: 8.5pt; font-weight: 700; color: #222; overflow-wrap: anywhere; }
  .thermal-card-body { display: flex; min-width: 0; gap: 2mm; justify-content: space-between; font-size: 8.5pt; color: #111; margin-bottom: 1mm; }
  .thermal-card-foot { display: flex; min-width: 0; gap: 2mm; justify-content: space-between; align-items: center; background: #fdfdfd; border-top: .2mm dashed #555; padding-top: 1mm; font-size: 10pt; font-weight: 900; color: #000; }
  .thermal-cards-total { display: flex; min-width: 0; gap: 2mm; justify-content: space-between; font-size: 11pt; font-weight: 900; border-top: .5mm solid #000; padding-top: 1.5mm; margin-bottom: 3mm; }

  .thermal-product-table th:first-child, .thermal-product-table td:first-child { width: 7mm; text-align: center; }
  .thermal-product-table th:nth-child(2), .thermal-product-table td:nth-child(2) { text-align: right; }
  .thermal-product-table td:last-child, .thermal-captain-table td:last-child { white-space: nowrap; }
  .report-paper-footer { display: flex; flex-direction: column; align-items: center; gap: 1mm; padding-top: 2mm; margin-top: 3mm; border-top: .35mm solid #000; color: #000; font-size: 9pt; font-weight: 800; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .report-paper > *, .report-paper h2, .report-paper h3, .report-paper p, .report-paper td, .report-paper th, .report-paper .thermal-card-body > *, .report-paper .thermal-card-foot > *, .report-paper .thermal-cards-total > * { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`

// The sold-materials report is its own compact thermal document. It is not
// the comprehensive report and deliberately contains only item aggregates.
const thermalMaterialsStyles = `
  @page { margin: 0; size: 80mm auto; }
  * { box-sizing: border-box; }
  html, body { width: 100% !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; position: static !important; background: #fff; color: #000; }
  body { direction: rtl; font-family: Tahoma, 'Arial Unicode MS', Arial, sans-serif; font-size: 10.5pt; font-weight: 600; line-height: 1.3; }
  .report-paper { display: block; width: 70mm; max-width: 70mm; min-width: 0; margin: 0 auto; padding: 1.5mm 0 4mm; background: #fff; box-sizing: border-box; overflow: visible; }
  .report-paper-header { text-align: center; padding: 0 0 1.5mm; margin: 0 0 1.5mm; border-bottom: .35mm solid #000; break-inside: avoid; }
  .materials-brand { margin-bottom: 1mm; font-size: 13pt; font-weight: 900; }
  .report-logo { display: block; width: 24mm; height: 24mm; max-width: 100%; object-fit: contain; margin: 0 auto 1.5mm; filter: brightness(0); }
  h2 { margin: 0 0 1.5mm; font-size: 16pt; font-weight: 900; line-height: 1.2; }
  p { margin: 0; }
  .print-table { width: 100%; margin: 0 0 3mm; border: .35mm solid #000; border-collapse: collapse; table-layout: fixed; }
  .print-table th, .print-table td { border: .3mm solid #000; padding: 1.7mm 1mm; text-align: center; vertical-align: middle; font-size: 9.5pt; font-weight: 600; overflow-wrap: anywhere; }
  .print-table th { font-weight: 800; }
  .print-table th:nth-child(1), .print-table td:nth-child(1) { width: 8mm; }
  .print-table th:nth-child(3), .print-table td:nth-child(3) { width: 12mm; }
  .print-table th:nth-child(4), .print-table td:nth-child(4) { width: 21mm; }
  .print-table tbody tr { break-inside: avoid; }
  .report-paper-footer { display: flex; flex-direction: column; align-items: center; gap: 1mm; padding-top: 2mm; margin-top: 3mm; border-top: .35mm solid #000; text-align: center; font-size: 9pt; font-weight: 800; }
  .summary-row td, tr.summary-row td { font-weight: 900 !important; border-top: .4mm solid #000 !important; }
  img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`

class ReportsErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('REPORTS_RENDER_ERROR', error) }
  render() {
    if (this.state.error) return <section className="reports-container" dir="rtl"><div className="reports-main"><div className="settings-notice" role="alert">تعذر عرض التقارير بسبب خطأ في بيانات التقرير. أعد المحاولة أو ارجع إلى الرئيسية.</div></div></section>
    return this.props.children
  }
}

function ReportsView({ onNavigate, session, operationalDay = null, onDirectThermalPrint, directThermalReady = false, salesOverride = null, cashboxTransactions = [], products = [], categories = [] }) {
  const [reportType, setReportType] = useState(null)
  const defaultBusinessDate = operationalDay?.businessDate || getDefaultReportDate()
  const [periodFrom, setPeriodFrom] = useState(() => defaultBusinessDate)
  const [periodTo, setPeriodTo] = useState(() => defaultBusinessDate)
  const [periodError, setPeriodError] = useState('')

  // Reports always open on the active business date and use one shared range.
  useEffect(() => {
    if (!operationalDay?.businessDate) return
    setPeriodFrom(operationalDay.businessDate)
    setPeriodTo(operationalDay.businessDate)
  }, [operationalDay?.id, operationalDay?.businessDate])

  // Keep reporting local-only until the ACC/Firebase source is explicitly
  // reconciled. A report must never silently mix another cashier's data with
  // this device's local ledger.
  const [sales, setSales] = useState(() => Array.isArray(salesOverride) ? salesOverride : readLocalSales())
  useEffect(() => {
    const refresh = () => setSales(readLocalSales())
    window.addEventListener('pos101-sales-updated', refresh)
    window.addEventListener('pos101-sale-created', refresh)
    return () => {
      window.removeEventListener('pos101-sales-updated', refresh)
      window.removeEventListener('pos101-sale-created', refresh)
    }
  }, [])
  useEffect(() => { if (Array.isArray(salesOverride)) setSales(salesOverride) }, [salesOverride])
  const [expenseOperationalDayDates, setExpenseOperationalDayDates] = useState({})
  const [expenseReadError, setExpenseReadError] = useState('')
  const expenseReadInFlight = useRef(false)
  const expenseReadQueued = useRef(false)
  const normalizeReportExpenses = (rows, operationalDayDates = expenseOperationalDayDates) => (Array.isArray(rows) ? rows : []).map(expense => {
    return normalizeExpense(expense, { operationalDayDates })
  })
  const [expenses, setExpenses] = useState(() => readLocalExpenses().map(normalizeExpense))
  useEffect(() => {
    let active = true
    let refreshTimer = null
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => { refreshTimer = null; void refreshCentral() }, 200)
    }
    const refreshCentral = async () => {
      if (expenseReadInFlight.current) { expenseReadQueued.current = true; return }
      expenseReadInFlight.current = true
      try {
        // readCentralExpensesForReports() remains the documented report entry point.
        const result = await readCentralExpensesForReports({ includeAllLocal: true, persistCache: false, dispatchUpdate: false })
        if (!active) return
        const operationalDayDates = result?.operationalDayDates || {}
        setExpenseOperationalDayDates(operationalDayDates)
        setExpenses(normalizeReportExpenses(result?.expenses || [], operationalDayDates))
        setExpenseReadError('')
      } catch (error) {
        if (!active) return
        setExpenseReadError(error?.message || 'تعذر قراءة المصاريف المركزية بعد التحقق من تسجيل الدخول.')
      } finally {
        expenseReadInFlight.current = false
        if (active && expenseReadQueued.current) { expenseReadQueued.current = false; scheduleRefresh() }
      }
    }
    window.addEventListener('pos101-expenses-updated', scheduleRefresh)
    void refreshCentral()
    return () => {
      active = false
      if (refreshTimer) window.clearTimeout(refreshTimer)
      window.removeEventListener('pos101-expenses-updated', scheduleRefresh)
    }
  }, [])

  // One range is shared by every report card, the browser print, and direct
  // thermal payloads. No report can silently fall back to the current day.
  const filteredSales = useMemo(() => filterRowsByBusinessDate(sales, periodFrom, periodTo), [sales, periodFrom, periodTo])
  const filteredExpenses = useMemo(() => filterRowsByBusinessDate(
    (Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates: expenseOperationalDayDates })),
    periodFrom,
    periodTo,
  ), [expenses, periodFrom, periodTo, expenseOperationalDayDates])

  const periodDataset = useMemo(() => {
    if (reportType !== 'period') return EMPTY_PERIOD_DATASET
    const valid = isValidDateRange(periodFrom, periodTo)
    const rangeSales = filterRowsByBusinessDate(sales, periodFrom, periodTo)
    const rangeExpenses = filterRowsByBusinessDate((Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates: expenseOperationalDayDates })), periodFrom, periodTo)
    const rangeTransactions = filterRowsByBusinessDate(cashboxTransactions, periodFrom, periodTo)
    const dailyMap = new Map()
    const ensureDay = date => { if (!dailyMap.has(date)) dailyMap.set(date, { businessDate: date, sales: 0, cash: 0, electronic: 0, expenses: 0, withdrawals: 0, deposits: 0, adjustments: 0, net: 0, orders: 0 }); return dailyMap.get(date) }
    rangeSales.forEach(row => { const day = ensureDay(businessDateOf(row)); const value = numberValue(row.total ?? row.subtotal); day.sales += value; day.orders += 1; if ((row.paymentMethod || row.payment?.method) === 'cash') day.cash += value; if ((row.paymentMethod || row.payment?.method) === 'electronic') day.electronic += value })
    rangeExpenses.forEach(row => { ensureDay(businessDateOf(row)).expenses += numberValue(row.amount) })
    rangeTransactions.forEach(row => { const day = ensureDay(businessDateOf(row)); const value = numberValue(row.amount); if (row.type === 'withdrawal') day.withdrawals += value; if (row.type === 'deposit' || row.type === 'return') day.deposits += value; if (row.type === 'adjustment') day.adjustments += numberValue(row.signedAmount ?? row.amount) })
    const daily = [...dailyMap.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).map(row => ({ ...row, net: row.cash - row.expenses - row.withdrawals + row.deposits + row.adjustments }))
    const grossSales = rangeSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)
    const cashSales = rangeSales.filter(row => (row.paymentMethod || row.payment?.method) === 'cash').reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)
    const electronicSales = rangeSales.filter(row => (row.paymentMethod || row.payment?.method) === 'electronic').reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)
    const expensesTotal = rangeExpenses.reduce((sum, row) => sum + numberValue(row.amount), 0)
    const withdrawals = rangeTransactions.filter(row => row.type === 'withdrawal').reduce((sum, row) => sum + numberValue(row.amount), 0)
    const deposits = rangeTransactions.filter(row => row.type === 'deposit' || row.type === 'return').reduce((sum, row) => sum + numberValue(row.amount), 0)
    const adjustments = rangeTransactions.filter(row => row.type === 'adjustment').reduce((sum, row) => sum + numberValue(row.signedAmount ?? row.amount), 0)
    const beforeTransactions = (Array.isArray(cashboxTransactions) ? cashboxTransactions : []).filter(row => businessDateOf(row) < periodFrom)
    const beforeSales = (Array.isArray(sales) ? sales : []).filter(row => businessDateOf(row) < periodFrom && (row.paymentMethod || row.payment?.method) === 'cash')
    const beforeExpenses = (Array.isArray(expenses) ? expenses : []).filter(row => businessDateOf(row) < periodFrom)
    const beforeBalance = calculateCashboxBalance(beforeTransactions) + beforeSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0) - beforeExpenses.reduce((sum, row) => sum + numberValue(row.amount), 0)
    const endTransactions = (Array.isArray(cashboxTransactions) ? cashboxTransactions : []).filter(row => businessDateOf(row) <= periodTo)
    const endSales = (Array.isArray(sales) ? sales : []).filter(row => businessDateOf(row) <= periodTo && (row.paymentMethod || row.payment?.method) === 'cash')
    const endExpenses = (Array.isArray(expenses) ? expenses : []).filter(row => businessDateOf(row) <= periodTo)
    const endBalance = calculateCashboxBalance(endTransactions) + endSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0) - endExpenses.reduce((sum, row) => sum + numberValue(row.amount), 0)
    const employeeMap = new Map()
    const addEmployee = (row, value, kind) => { const name = row.employeeNameSnapshot || row.cashierNameSnapshot || row.person || row.seller || row.cashierName || 'غير محدد'; const key = String(row.employeeId || row.cashierId || name); const current = employeeMap.get(key) || { name, orders: 0, sales: 0, expenses: 0, withdrawals: 0 }; if (kind === 'sale') { current.orders += 1; current.sales += value } else if (kind === 'withdrawal') current.withdrawals += value; else current.expenses += value; employeeMap.set(key, current) }
    rangeSales.forEach(row => addEmployee(row, numberValue(row.total ?? row.subtotal), 'sale'))
    rangeExpenses.forEach(row => addEmployee(row, numberValue(row.amount), 'expense'))
    rangeTransactions.filter(row => row.type === 'withdrawal').forEach(row => addEmployee(row, numberValue(row.amount), 'withdrawal'))
    return { valid, sales: rangeSales, expenses: rangeExpenses, transactions: rangeTransactions, daily, employees: [...employeeMap.values()], summary: { grossSales, cashSales, electronicSales, expensesTotal, withdrawals, deposits, adjustments, orderCount: rangeSales.length, averageOrder: rangeSales.length ? grossSales / rangeSales.length : 0, netCash: cashSales - expensesTotal - withdrawals + deposits + adjustments, beforeBalance, endBalance } }
  }, [periodFrom, periodTo, sales, expenses, cashboxTransactions, expenseOperationalDayDates])

  const openPeriodReport = () => {
    if (!periodFrom || !periodTo || periodFrom > periodTo) { setPeriodError('من تاريخ يجب أن يكون قبل أو يساوي إلى تاريخ.'); return }
    setPeriodError('')
    setReportType('period')
  }

  const printReport = (format) => {
    const paper = document.querySelector('.report-paper')
    if (!paper) return

    // Opening the window in the click handler avoids popup blocking.  Copying
    // already-rendered markup preserves React's escaped local data safely.
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      window.alert('تعذر فتح معاينة التقرير. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.')
      return
    }
    // Keep the print document same-origin and give Chrome a meaningful URL.
    // If Headers and footers are accidentally enabled, this avoids printing
    // `about:blank` while the user can still disable them in the dialog.
    try { printWindow.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}#print-report`) } catch {}
    printWindow.document.open()
    const isA4 = format === 'a4'
    const isMaterials = reportType === 'materials'
    const printStyles = isA4 ? a4PrintStyles : (isMaterials ? thermalMaterialsStyles : thermalComprehensiveStyles)
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${window.location.href}"><link rel="icon" href="data:,"><title>معاينة التقرير</title><style>${printStyles}</style></head><body class="${isA4 ? 'a4-body' : 'thermal-body'}">${paper.outerHTML}</body></html>`)
    printWindow.document.close()

    const waitForAssetsAndPrint = async () => {
      const images = [...printWindow.document.images]
      await Promise.all(images.map(image => {
        if (image.complete) return image.decode ? image.decode().catch(() => {}) : Promise.resolve()
        return new Promise(resolve => {
          image.addEventListener('load', () => resolve(image.decode ? image.decode().catch(() => {}) : undefined), { once: true })
          image.addEventListener('error', resolve, { once: true })
        })
      }))
      await (printWindow.document.fonts?.ready || Promise.resolve())
      await new Promise(resolve => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(resolve)))
      printWindow.focus()
      printWindow.print()
    }
    waitForAssetsAndPrint()
  }

  const printReportDirect = () => {
    if (!directThermalReady || !onDirectThermalPrint) return
    const titleByType = { comprehensive: 'تقرير شامل', period: 'تقرير الفترة', sales: 'تقرير الطلبات / المبيعات', morning: 'تقرير المبيعات - وردية صباحية', evening: 'تقرير المبيعات - وردية مسائية', materials: 'تقرير مبيعات المواد', expenses: 'تقرير المصاريف', captain: 'تقرير مبيعات الكابتن' }
    const summary = reportType === 'comprehensive'
      ? calculateComprehensiveSummary(filteredSales, filteredExpenses)
      : undefined
    onDirectThermalPrint({ reportType, title: titleByType[reportType] || 'تقرير المبيعات', reportDate: periodFrom, dateFrom: periodFrom, dateTo: periodTo, period: `${periodFrom} إلى ${periodTo}`, sales: filteredSales, expenses: filteredExpenses, ...(reportType === 'materials' ? { products, categories, materials: buildMaterialsReport({ sales: filteredSales, products, categories }) } : {}), ...(summary ? { summary } : {}) })
  }

  const renderReportCards = () => (
    <div className="reports-container" dir="rtl">
      <div className="reports-main">
        {expenseReadError && <div className="settings-notice" role="alert">{expenseReadError}</div>}
        <div className="reports-header">
          <div><h2>التقارير</h2><p>اختر فترة واحدة لتطبيقها على جميع التقارير.</p></div>
          <button className="outline-btn" onClick={() => onNavigate('dashboard')}>العودة للرئيسية</button>
        </div>
        <div className="reports-range-toolbar" aria-label="فلتر فترة التقارير">
          <label>من تاريخ<input aria-label="من تاريخ" type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} /></label>
          <label>إلى تاريخ<input aria-label="إلى تاريخ" type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} /></label>
          <button className="primary-action" type="button" onClick={openPeriodReport}>عرض التقرير</button>
          <button className="outline-btn" type="button" onClick={openPeriodReport}>طباعة الفترة</button>
        </div>
        <div className="reports-shortcuts" aria-label="اختصارات الفترة">
          <button type="button" onClick={() => { const today = defaultBusinessDate; setPeriodFrom(today); setPeriodTo(today) }}>اليوم</button>
          <button type="button" onClick={() => { const yesterday = shiftDate(defaultBusinessDate, -1); setPeriodFrom(yesterday); setPeriodTo(yesterday) }}>أمس</button>
          <button type="button" onClick={() => { setPeriodFrom(shiftDate(defaultBusinessDate, -6)); setPeriodTo(defaultBusinessDate) }}>آخر 7 أيام</button>
          <button type="button" onClick={() => { setPeriodFrom(`${defaultBusinessDate.slice(0, 7)}-01`); setPeriodTo(defaultBusinessDate) }}>هذا الشهر</button>
        </div>
        {periodError && <p className="form-error" role="alert">{periodError}</p>}
        
        <div className="reports-grid">
          <button className="report-card-btn" onClick={() => setReportType('comprehensive')}>
            <Icon name="file-text" size={40} />
            <b>تقرير شامل (صباحي ومسائي)</b>
            <small>كل البيانات ضمن الفترة المختارة</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('sales')}>
            <Icon name="receipt" size={40} />
            <b>تقرير الطلبات / المبيعات</b>
            <small>كل المبيعات ضمن الفترة المختارة</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('materials')}>
            <Icon name="box" size={40} />
            <b>تقرير المواد</b>
            <small>المواد المباعة ضمن الفترة المختارة</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('expenses')}>
            <Icon name="wallet" size={40} />
            <b>تقرير المصاريف</b>
            <small>المصاريف ضمن الفترة المختارة</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('captain')}>
            <Icon name="user" size={40} />
            <b>تقرير مبيعات الكابتن</b>
            <small>مبيعات الكباتن ضمن الفترة المختارة</small>
          </button>
        </div>
      </div>
    </div>
  )

  const renderPrintableReport = () => {
    let title = ''
    let content = null
    
    // Aggregation logic
    const aggregateSales = (sList) => {
      const gross = sList.reduce((acc, s) => acc + numberValue(s.subtotal), 0)
      const discounts = sList.reduce((acc, s) => acc + numberValue(s.discount), 0)
      
      // Calculate refunds explicitly from adjustments
      const refunds = sList.reduce((acc, s) => {
        if (!s.order?.adjustments) return acc;
        return acc + s.order.adjustments.filter(a => a.type === 'refund').reduce((sum, a) => sum + numberValue(a.amount), 0)
      }, 0)

      const net = gross - discounts - refunds
      const count = sList.length
      return { gross, discounts, refunds, net, count, avg: count ? net / count : 0 }
    }

    const salesDetails = sList => thermalSalesDetails(sList);

    const thermalSalesDetails = sList => (
      <section className="sales-details">
        <h3>تفاصيل عمليات البيع</h3>
        <div className="thermal-cards-list">
          {sList.map((sale, index) => (
            <div className="thermal-sale-card" key={sale.id || `${formatNumber(sale.orderNumber)}-${sale.createdAt}`}>
              <div className="thermal-card-head">
                <b className="order-no">طلب #{formatNumber(sale.orderNumber || index + 1)}</b>
                <span className="order-dt" dir="ltr" title={`وقت البيع الفعلي: ${formatDateTime(sale.createdAt)}`}>
                  {`${businessDateOf(sale)} ${formatTime(sale.createdAt, { hour: '2-digit', minute: '2-digit', hour12: false })}`}
                </span>
              </div>
              <div className="thermal-card-body">
                <span>الكابتن: <b>{sale.seller || sale.cashierNameSnapshot || 'غير محدد'}</b></span>
                <span>الدفع: <b>{sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</b></span>
              </div>
              <div className="thermal-card-foot">
                <span>الإجمالي</span>
                <b dir="ltr">{format(sale.total)}</b>
              </div>
            </div>
          ))}
          {!sList.length && <div className="thermal-sale-card empty">لا توجد مبيعات ضمن الفترة المحددة</div>}
        </div>
        <div className="thermal-cards-total">
          <span>إجمالي عمليات البيع</span>
          <b dir="ltr">{format(sList.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</b>
        </div>
      </section>
    )

    const thermalProductDetails = sList => {
      const products = new Map()
      sList.forEach(sale => (sale.items || sale.order?.items || []).forEach(item => {
        const row = products.get(item.name) || { quantity: 0, total: 0 }
        row.quantity += Number(item.quantity || 0)
        row.total += Number(item.quantity || 0) * Number(item.price || 0)
        products.set(item.name, row)
      }))
      return <section className="sales-details">
        <h3>تفاصيل المبيعات حسب المادة</h3>
        <table className="print-table thermal-product-table">
          <thead><tr><th>اسم المادة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {[...products.entries()].sort((a, b) => b[1].quantity - a[1].quantity).map(([name, row]) => <tr key={name}><td>{name}</td><td>{formatNumber(row.quantity)}</td><td>{format(row.total)}</td></tr>)}
            {!products.size && <tr><td colSpan="3">لا توجد تفاصيل مواد ضمن الفترة المحددة</td></tr>}
          </tbody>
        </table>
      </section>
    }

    const thermalCaptainDetails = sList => {
      const captains = new Map()
      sList.forEach(sale => {
        const name = sale.seller || sale.cashierNameSnapshot || 'غير محدد'
        const row = captains.get(name) || { count: 0, total: 0 }
        row.count += 1
        row.total += Number(sale.total || 0)
        captains.set(name, row)
      })
      return <section className="sales-details">
        <h3>تفاصيل المبيعات حسب الكاشير</h3>
        <table className="print-table thermal-captain-table">
          <thead><tr><th>الاسم</th><th>الطلبات</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {[...captains.entries()].map(([name, row]) => <tr key={name}><td>{name}</td><td>{formatNumber(row.count)}</td><td>{format(row.total)}</td></tr>)}
            {!captains.size && <tr><td colSpan="3">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
          </tbody>
        </table>
      </section>
    }

    if (reportType === 'period') {
      title = 'تقرير الفترة'
      const s = periodDataset.summary
      const kpis = [['إجمالي المبيعات', s.grossSales], ['المبيعات النقدية', s.cashSales], ['المبيعات الإلكترونية', s.electronicSales], ['إجمالي المصاريف', s.expensesTotal], ['سحوبات الصندوق', s.withdrawals], ['إيداعات الصندوق', s.deposits], ['التعديلات', s.adjustments], ['عدد الطلبات', s.orderCount], ['متوسط قيمة الطلب', s.averageOrder], ['صافي النقد', s.netCash], ['رصيد أول الفترة', s.beforeBalance], ['رصيد آخر الفترة', s.endBalance]]
      content = <>
        {!periodDataset.valid || (!periodDataset.sales.length && !periodDataset.expenses.length && !periodDataset.transactions.length) ? <p className="settings-notice">{periodDataset.valid ? 'لا توجد بيانات ضمن الفترة المختارة.' : 'من تاريخ يجب أن يكون قبل أو يساوي إلى تاريخ.'}</p> : <>
          <table className="print-table report-summary"><tbody>{kpis.map(([label, value]) => <tr key={label}><td>{label}</td><td className="number-cell">{label === 'عدد الطلبات' ? formatNumber(value) : format(value)}</td></tr>)}</tbody></table>
          <>
            <h3>التفصيل اليومي</h3><table className="print-table"><thead><tr><th>businessDate</th><th>المبيعات</th><th>نقدي</th><th>إلكتروني</th><th>المصاريف</th><th>السحوبات</th><th>الإيداعات</th><th>الصافي</th><th>الطلبات</th></tr></thead><tbody>{periodDataset.daily.map(row => <tr key={row.businessDate}><td>{row.businessDate}</td><td>{format(row.sales)}</td><td>{format(row.cash)}</td><td>{format(row.electronic)}</td><td>{format(row.expenses)}</td><td>{format(row.withdrawals)}</td><td>{format(row.deposits)}</td><td>{format(row.net)}</td><td>{formatNumber(row.orders)}</td></tr>)}</tbody></table>
            <h3>تفصيل الموظفين والكاشير</h3><table className="print-table"><thead><tr><th>الاسم</th><th>الطلبات</th><th>المبيعات</th><th>المصاريف</th><th>السحوبات</th></tr></thead><tbody>{periodDataset.employees.map(row => <tr key={row.name}><td>{row.name}</td><td>{formatNumber(row.orders)}</td><td>{format(row.sales)}</td><td>{format(row.expenses)}</td><td>{format(row.withdrawals)}</td></tr>)}</tbody></table>
          </>
        </>}
      </>
    } else if (reportType === 'comprehensive') {
      title = 'تقرير شامل'
      const stats = aggregateSales(filteredSales)
      const summary = calculateComprehensiveSummary(filteredSales, filteredExpenses)
      const { grossSales, discounts, expenses: expensesTotal, netAfterDiscount, netAfterExpenses, netAfterExpensesAndDiscount, netCashAfterAll } = summary
      const totalServiceCharge = filteredSales.reduce((sum, s) => sum + Number(s.service || 0), 0)
      const cashTotal = filteredSales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + numberValue(s.total), 0)
      const electronicTotal = filteredSales.filter(s => s.paymentMethod === 'electronic').reduce((sum, s) => sum + numberValue(s.total), 0)

      // Aggregate products sold
      const productMap = new Map()
      filteredSales.forEach(sale => {
        const saleItems = sale.items || sale.order?.items || []
        saleItems.forEach(item => {
          const row = productMap.get(item.name) || { quantity: 0, total: 0 }
          row.quantity += Number(item.quantity || 0)
          row.total += Number(item.quantity || 0) * Number(item.price || 0)
          productMap.set(item.name, row)
        })
      })
      const productList = [...productMap.entries()].sort((a, b) => b[1].quantity - a[1].quantity)
      const totalProductQty = productList.reduce((s, [, r]) => s + r.quantity, 0)
      const totalProductAmt = productList.reduce((s, [, r]) => s + r.total, 0)

      content = <>
        {/* ── Summary Table ── */}
        <table className="print-table report-summary">
          <tbody>
            <tr><td>إجمالي المبيعات</td><td className="number-cell">{format(grossSales)}</td></tr>
            <tr><td>إجمالي الخصومات</td><td className="number-cell">{format(discounts)}</td></tr>
            <tr><td>إجمالي المصاريف</td><td className="number-cell">{format(expensesTotal)}</td></tr>
            <tr><td>صافي البيع بعد الخصومات</td><td className="number-cell">{format(netAfterDiscount)}</td></tr>
            <tr><td>صافي البيع بعد المصاريف</td><td className="number-cell">{format(netAfterExpenses)}</td></tr>
            <tr className="summary-highlight"><td>صافي البيع بعد المصاريف والخصومات</td><td className="number-cell">{format(netAfterExpensesAndDiscount)}</td></tr>
            <tr><td>صافي البيع بدون الإلكتروني والمصاريف والخصومات</td><td className="number-cell">{format(netCashAfterAll)}</td></tr>
            <tr><td>إجمالي الخدمة</td><td className="number-cell">{format(totalServiceCharge)}</td></tr>
            <tr><td>إجمالي التسديدات</td><td className="number-cell">{format(0)}</td></tr>
            <tr><td>النقدي</td><td className="number-cell">{format(cashTotal)}</td></tr>
            <tr><td>الإلكتروني</td><td className="number-cell">{format(electronicTotal)}</td></tr>
            <tr><td>عدد الطلبات</td><td className="number-cell">{formatNumber(stats.count)}</td></tr>
          </tbody>
        </table>

        {/* ── Product Details Section ── */}
        <h3>تفاصيل المبيعات</h3>
        <table className="print-table thermal-product-table">
          <thead><tr><th>ت</th><th>اسم المادة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {productList.map(([name, row], idx) => (
              <tr key={name}><td>{formatNumber(idx + 1)}</td><td>{name}</td><td>{formatNumber(row.quantity)}</td><td className="number-cell">{format(row.total)}</td></tr>
            ))}
            {!productList.length && <tr><td colSpan="4">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
            <tr className="summary-row"><td colSpan="2">إجمالي المبيعات</td><td>{formatNumber(totalProductQty)}</td><td className="number-cell">{format(totalProductAmt)}</td></tr>
            <tr className="summary-row"><td colSpan="2">إجمالي الكمية</td><td>{formatNumber(totalProductQty)}</td><td></td></tr>
          </tbody>
        </table>

        {/* ── Gift/Complimentary Items Section ── */}
        {(() => {
          const giftItems = new Map()
          filteredSales.forEach(sale => {
            if (sale.discount && sale.discount > 0) {
              const saleItems = sale.items || sale.order?.items || []
              saleItems.forEach(item => {
                const row = giftItems.get(item.name) || { quantity: 0, total: 0 }
                row.quantity += Number(item.quantity || 0)
                row.total += Number(item.quantity || 0) * Number(item.price || 0)
                giftItems.set(item.name, row)
              })
            }
          })
          const giftList = [...giftItems.entries()]
          const giftQty = giftList.reduce((s, [, r]) => s + r.quantity, 0)
          const giftAmt = giftList.reduce((s, [, r]) => s + r.total, 0)
          return <>
            <h3>تقرير مبيعات الهديا</h3>
            <table className="print-table thermal-product-table">
              <thead><tr><th>ت</th><th>اسم المادة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {giftList.map(([name, row], idx) => (
                  <tr key={name}><td>{formatNumber(idx + 1)}</td><td>{name}</td><td>{formatNumber(row.quantity)}</td><td className="number-cell">{format(row.total)}</td></tr>
                ))}
                {!giftList.length && <tr><td colSpan="4">لا توجد هدايا ضمن الفترة المحددة</td></tr>}
                {giftList.length > 0 && <>
                  <tr className="summary-row"><td colSpan="2">إجمالي الهدايا</td><td>{formatNumber(giftQty)}</td><td className="number-cell">{format(giftAmt)}</td></tr>
                  <tr className="summary-row"><td colSpan="2">إجمالي الكمية</td><td>{formatNumber(giftQty)}</td><td></td></tr>
                </>}
              </tbody>
            </table>
          </>
        })()}

      </>
    } else if (reportType === 'sales') {
      title = 'تقرير الطلبات / المبيعات'
      const stats = aggregateSales(filteredSales)
      const cashTotal = filteredSales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + numberValue(s.total), 0)
      const electronicTotal = filteredSales.filter(s => s.paymentMethod === 'electronic').reduce((sum, s) => sum + numberValue(s.total), 0)
      content = <>
        <table className="print-table report-summary" data-testid="sales-report-summary">
          <tbody>
            <tr><td>عدد الطلبات</td><td className="number-cell">{formatNumber(stats.count)}</td></tr>
            <tr><td>إجمالي المبيعات</td><td className="number-cell">{format(stats.net)}</td></tr>
            <tr><td>إجمالي الخصم</td><td className="number-cell">{format(stats.discounts)}</td></tr>
            <tr><td>النقدي</td><td className="number-cell">{format(cashTotal)}</td></tr>
            <tr><td>الإلكتروني</td><td className="number-cell">{format(electronicTotal)}</td></tr>
          </tbody>
        </table>
        {thermalSalesDetails(filteredSales)}
      </>
    } else if (reportType === 'morning' || reportType === 'evening') {
      const isMorning = reportType === 'morning'
      title = isMorning ? 'تقرير المبيعات - وردية صباحية' : 'تقرير المبيعات - وردية مسائية'
      const targetShift = isMorning ? 'كاشير صباحي' : 'كاشير مسائي'
      
      const sList = filteredSales.filter(s => s.shift === targetShift)
      const stats = aggregateSales(sList)
      
      const eList = filteredExpenses.filter(e => e.shift === targetShift)
      const expensesTotal = sumExpenses(eList)
      
      content = <><table className="print-table"><thead><tr><th>البيان</th><th>المبلغ (IQD)</th></tr></thead><tbody><tr><td>إجمالي المبيعات</td><td>{format(stats.gross)}</td></tr><tr><td>الخصومات</td><td>{format(stats.discounts)}</td></tr><tr><td>المرتجعات</td><td>{format(stats.refunds)}</td></tr><tr><td>صافي المبيعات</td><td>{format(stats.net)}</td></tr><tr><td>المصاريف</td><td>{format(expensesTotal)}</td></tr><tr><td>عدد الطلبات</td><td>{formatNumber(stats.count)}</td></tr><tr><td>المتوسط لكل طلب</td><td>{format(stats.avg)}</td></tr></tbody></table>{thermalSalesDetails(sList)}</>
    } else if (reportType === 'materials') {
      title = 'تقرير مبيعات المواد'
      const materials = buildMaterialsReport({ sales: filteredSales, products, categories })
      content = <>
        {materials.sections.map(section => <section className="materials-section" data-category-id={section.id} key={section.id}>
          <h3>{section.name}</h3>
          <table className="print-table materials-table">
            <thead><tr><th>ت</th><th>اسم المادة</th><th>الكمية</th><th>إجمالي البيع</th></tr></thead>
            <tbody>
              {section.items.map((item, idx) => <tr key={item.name}><td>{formatNumber(idx + 1)}</td><td>{item.name}</td><td>{formatNumber(item.quantity)}</td><td>{format(item.total)}</td></tr>)}
              <tr className="summary-row"><td colSpan="2">مجموع {section.name}</td><td>{formatNumber(section.quantity)}</td><td>{format(section.total)}</td></tr>
            </tbody>
          </table>
        </section>)}
        {!materials.sections.length && <table className="print-table"><tbody><tr><td>لا توجد مبيعات</td></tr></tbody></table>}
        <table className="print-table report-summary materials-grand-total" data-testid="materials-grand-total"><tbody><tr className="summary-highlight"><td>الإجمالي العام</td><td>{formatNumber(materials.grandQuantity)}</td><td>{format(materials.grandTotal)}</td></tr></tbody></table>
      </>
    } else if (reportType === 'expenses') {
      title = 'تقرير المصاريف'
      content = (
        <table className="print-table">
          <thead><tr><th>#</th><th>نوع المصروف</th><th>المبلغ</th></tr></thead>
          <tbody>
            {filteredExpenses.map((e, idx) => (
              <tr key={e.id}>
                <td>{formatNumber(idx + 1)}</td>
                <td>{e.category} - {e.notes}</td>
                <td>{format(e.amount)}</td>
              </tr>
            ))}
            {filteredExpenses.length === 0 && <tr><td colSpan="3">لا توجد مصاريف مسجلة</td></tr>}
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan="2">إجمالي المصاريف</td>
              <td>{format(sumExpenses(filteredExpenses))}</td>
            </tr>
          </tbody>
        </table>
      )
    } else if (reportType === 'captain') {
      title = 'تقرير مبيعات الكابتن'
      const captains = {}
      filteredSales.forEach(s => {
        const seller = s.seller || 'غير محدد'
        if (!captains[seller]) captains[seller] = { count: 0, total: 0 }
        captains[seller].count += 1
        captains[seller].total += s.total
      })
      const list = Object.entries(captains).sort((a, b) => b[1].total - a[1].total)
      
      content = (
        <table className="print-table">
          <thead><tr><th>#</th><th>اسم الكابتن</th><th>عدد الطلبات</th><th>إجمالي المبيعات</th></tr></thead>
          <tbody>
            {list.map(([name, data], idx) => (
              <tr key={name}>
                <td>{formatNumber(idx + 1)}</td>
                <td>{name}</td>
                <td>{formatNumber(data.count)}</td>
                <td>{format(data.total)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="4">لا توجد مبيعات</td></tr>}
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan="2">الإجمالي</td>
              <td>{formatNumber(list.reduce((sum, item) => sum + item[1].count, 0))}</td>
              <td>{format(list.reduce((sum, item) => sum + item[1].total, 0))}</td>
            </tr>
          </tbody>
        </table>
      )
    }

    return (
      <div className="report-view-container" dir="rtl">
        <div className="report-view-header non-printable">
          <button className="outline-btn" onClick={() => setReportType(null)}>العودة للتقارير</button>
          <div className="report-print-actions" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="primary-action" type="button" onClick={() => printReport('a4')}><Icon name="printer" size={20} /> طباعة A4 / PDF</button>
            <button className="outline-btn" type="button" onClick={() => printReport('thermal')}><Icon name="printer" size={20} /> طباعة حرارية 80mm</button>
          </div>
        </div>
        
        <div className={`report-paper${reportType === 'comprehensive' ? ' comprehensive-report' : reportType === 'materials' ? ' materials-report' : ''}`}>
          <div className="report-paper-header">
            <img src={logoUrl} alt="101 COFFEE HOUSE" className="report-logo" />
            {reportType === 'materials' && <div className="materials-brand">101 COFFEE HOUSE</div>}
            <h2>{title}</h2>
            <p>من {periodFrom} إلى {periodTo}</p>
            <p>تاريخ الطباعة: {getDefaultReportDate()} · المستخدم: {session?.name || session?.shiftName || 'الإدارة'}</p>
          </div>
          
          {content}
          
          <div className="report-paper-footer">
            <p>شكراً لكم</p>
            <p>101 COFFEE HOUSE ❤</p>
            <p dir="ltr">GOOD COFFEE \ GOOD PEOPLE \ BETTER DAYS</p>
          </div>
        </div>
      </div>
    )
  }

  return reportType ? renderPrintableReport() : renderReportCards()
}

export default function Reports(props) {
  return <ReportsErrorBoundary><ReportsView {...props} /></ReportsErrorBoundary>
}
