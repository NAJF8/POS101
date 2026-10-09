import React, { useEffect, useState, useMemo, useRef } from 'react'
import { Icon } from './Icons'
import { logoDataUri } from '../assets/logo'

import { formatMoney, formatDateTime, formatTime, formatNumber } from '../utils.js'
import { getReportSalesForPeriod, readLocalSales, numberValue } from '../services/reportSales'
import { calculateComprehensiveSummary } from '../services/comprehensiveReport'
import { isActiveExpense, isCashboxExpense, isRegularExpense, isWithdrawalExpense, normalizeExpense, sumExpenses } from '../services/expenseReporting.js'
import { calculateCashboxBalance, calculateCashboxDay, getEffectiveSettlement, hasActualCash, toMoneyNumber } from '../services/financialCenter.js'
import { readCentralExpensesForReports, readLocalExpenses, subscribeCentralExpenses } from '../services/posCentralSync.js'
import { businessDateOf, filterRowsByBusinessDate, isValidDateRange } from '../services/periodReport.js'
import { buildMaterialsReport } from '../services/materialsReport.js'
import { buildEmployeeReport, filterEmployeeSummaries, matchesEmployee } from '../services/employeeReport.js'
import { buildCaptainReport, filterCaptainCandidates } from '../services/captainReport.js'
import { filterCashOutflowReport, normalizeCashOutflowReport, summarizeCashOutflowReport, sumCashOutflowReport } from '../services/cashOutflowReport.js'
import { buildManagementPaymentsReport } from '../services/managementPaymentsReport.js'
import { buildDeliveryDiscountReport, deliverySourceLabel } from '../services/deliveryDiscountReport.js'
import { buildEndDayShiftReport, buildShiftReport } from '../services/shiftReports.js'

const EMPTY_PERIOD_DATASET = { valid: false, sales: [], expenses: [], transactions: [], daily: [], employees: [], summary: { grossSales: 0, cashSales: 0, electronicSales: 0, expensesTotal: 0, withdrawals: 0, deposits: 0, adjustments: 0, orderCount: 0, averageOrder: 0, netCash: 0, beforeBalance: 0, endBalance: 0 } }
const format = formatMoney
const ACTUAL_CASH_PENDING = 'بانتظار إدخال الكاش الفعلي'
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
  .report-logo { display: none; }
  .report-paper-footer { display: flex; justify-content: space-between; gap: 6mm; padding-top: 4mm; margin-top: 7mm; border-top: .35mm solid #000; color: #000; font-weight: 800; }
  .employee-summary-thermal { display: none; }
  thead { display: table-header-group; }
  tr, .report-paper-header, .report-paper-footer { break-inside: avoid; page-break-inside: avoid; }
  .non-printable { display: none !important; }
  .employee-report-paper { font-size: 10pt; line-height: 1.25; }
  .employee-report-paper .report-paper-header { padding-bottom: 2mm; margin-bottom: 3mm; }
  .employee-report-paper h2 { font-size: 14pt; margin-bottom: 1mm; }
  .employee-report-paper h3 { font-size: 11pt; margin: 3mm 0 1.5mm; }
  .employee-report-paper .print-table { margin-bottom: 3mm; }
  .employee-report-paper .print-table th, .employee-report-paper .print-table td { padding: 1.2mm; font-size: 9pt; line-height: 1.2; }
  .employee-report-paper .summary-highlight td, .employee-report-paper .summary-row td { font-size: 9pt; }
  .delivery-discount-paper .print-table th, .delivery-discount-paper .print-table td { padding: 1.4mm; font-size: 8.5pt; line-height: 1.2; }
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
  .report-logo, .materials-brand, .report-paper-footer { display: none !important; }
  .employee-summary-thermal { display: block; margin: 0 0 3mm; }
  .employee-summary-a4 { display: none; }
  .employee-thermal-card { border: .3mm solid #000; padding: 1.2mm; margin: 0 0 1.5mm; break-inside: avoid; page-break-inside: avoid; }
  .employee-thermal-card-head { display: flex; justify-content: space-between; gap: 2mm; border-bottom: .2mm dashed #555; padding-bottom: .8mm; margin-bottom: .8mm; font-size: 9.5pt; }
  .employee-thermal-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6mm 2mm; font-size: 8.5pt; line-height: 1.25; }
  .employee-thermal-metrics span { display: flex; justify-content: space-between; gap: 1mm; min-width: 0; }
  .employee-thermal-metrics b { white-space: nowrap; }
  .employee-thermal-net { border-top: .3mm solid #000; padding-top: .6mm; font-weight: 900; }
  .employee-thermal-total { border-width: .5mm; }
  .employee-thermal-empty { border: .3mm solid #000; padding: 2mm; text-align: center; }
  .delivery-discount-paper .print-table th, .delivery-discount-paper .print-table td { padding: 1mm .6mm; font-size: 7.5pt; line-height: 1.15; }
  .delivery-discount-paper h2 { font-size: 13pt; }
  .delivery-discount-paper h3 { font-size: 10pt; }
  .non-printable { display: none !important; }
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
  .report-logo, .materials-brand, .report-paper-footer { display: none !important; }
  .employee-summary-thermal { display: block; margin: 0 0 3mm; }
  .employee-summary-a4 { display: none; }
  .employee-thermal-card { border: .3mm solid #000; padding: 1.2mm; margin: 0 0 1.5mm; break-inside: avoid; page-break-inside: avoid; }
  .employee-thermal-card-head { display: flex; justify-content: space-between; gap: 2mm; border-bottom: .2mm dashed #555; padding-bottom: .8mm; margin-bottom: .8mm; font-size: 9.5pt; }
  .employee-thermal-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6mm 2mm; font-size: 8.5pt; line-height: 1.25; }
  .employee-thermal-metrics span { display: flex; justify-content: space-between; gap: 1mm; min-width: 0; }
  .employee-thermal-metrics b { white-space: nowrap; }
  .employee-thermal-net { border-top: .3mm solid #000; padding-top: .6mm; font-weight: 900; }
  .employee-thermal-total { border-width: .5mm; }
  .employee-thermal-empty { border: .3mm solid #000; padding: 2mm; text-align: center; }
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

function ReportsView({ onNavigate, session, operationalDay = null, onDirectThermalPrint, onBeforePrint, directThermalReady = false, salesOverride = null, centralSales = [], operationalDays = [], settlements = [], settlementCorrections = [], cashboxTransactions = [], staff = [], products = [], categories = [], initialReportType = null }) {
  const [reportType, setReportType] = useState(initialReportType)
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [captainQuery, setCaptainQuery] = useState('')
  const [selectedCaptainId, setSelectedCaptainId] = useState('')
  const [captainStage, setCaptainStage] = useState('selection')
  const [captainSections, setCaptainSections] = useState(['sales', 'expenses', 'withdrawals', 'salary'])
  const defaultBusinessDate = operationalDay?.businessDate || getDefaultReportDate()
  const [periodFrom, setPeriodFrom] = useState(() => defaultBusinessDate)
  const [periodTo, setPeriodTo] = useState(() => defaultBusinessDate)
  const [periodError, setPeriodError] = useState('')
  const [expenseTypeFilter, setExpenseTypeFilter] = useState('all')
  const [managementTypeFilter, setManagementTypeFilter] = useState('all')
  const [deliverySourceFilter, setDeliverySourceFilter] = useState('all')
  const [expenseRealtimeMeta, setExpenseRealtimeMeta] = useState({ firebaseExpenseCount: null, lastUpdatedExpenseId: '', lastRealtimeUpdateAt: null })

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
  const [reportOperationalDays, setReportOperationalDays] = useState(operationalDays)
  useEffect(() => {
    if (Array.isArray(operationalDays) && operationalDays.length) setReportOperationalDays(operationalDays)
  }, [operationalDays])
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
        if (Array.isArray(result?.operationalDays)) setReportOperationalDays(result.operationalDays)
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
    const stopRealtime = subscribeCentralExpenses((merged, meta = {}) => {
      if (active) setExpenseRealtimeMeta({ firebaseExpenseCount: meta.centralCount ?? null, lastUpdatedExpenseId: meta.centralExpenses?.slice?.(-1)?.[0]?.id || '', lastRealtimeUpdateAt: Date.now() })
      scheduleRefresh()
    })
    void refreshCentral()
    return () => {
      active = false
      if (refreshTimer) window.clearTimeout(refreshTimer)
      window.removeEventListener('pos101-expenses-updated', scheduleRefresh)
      stopRealtime?.()
    }
  }, [])

  // One range is shared by every report card, the browser print, and direct
  // thermal payloads. No report can silently fall back to the current day.
  const reportSales = useMemo(() => getReportSalesForPeriod({ localSales: sales, centralSales, operationalDays: reportOperationalDays, from: periodFrom, to: periodTo, currentOperationalDay: operationalDay }), [sales, centralSales, reportOperationalDays, periodFrom, periodTo, operationalDay])
  const filteredSales = useMemo(() => reportSales, [reportSales])
  const selectedClosedDay = useMemo(() => periodFrom === periodTo ? reportOperationalDays.find(day => day?.status === 'closed' && String(day.businessDate) === periodFrom) : null, [reportOperationalDays, periodFrom, periodTo])
  const storedSettlement = useMemo(() => selectedClosedDay ? (Array.isArray(settlements) ? settlements : []).find(row => String(row?.operationalDayId || '') === String(selectedClosedDay.id || selectedClosedDay.operationalDayId || '') || String(row?.businessDate || '') === periodFrom) : null, [selectedClosedDay, settlements, periodFrom])
  const postCloseDrift = Boolean(storedSettlement && (Number(storedSettlement.orderCount || 0) !== filteredSales.length || Number(storedSettlement.sales || 0) !== filteredSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)))
  const reportSource = selectedClosedDay ? 'firebase-central' : 'merged-safe'
  const filteredExpenses = useMemo(() => {
    const normalized = (Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates: expenseOperationalDayDates })).filter(isActiveExpense)
    const currentDayId = periodFrom === periodTo && String((selectedClosedDay || operationalDay)?.id || '')
    const dayScoped = currentDayId ? normalized.filter(row => String(row.operationalDayId || '') === currentDayId) : normalized
    return filterRowsByBusinessDate(dayScoped, periodFrom, periodTo)
  }, [expenses, periodFrom, periodTo, expenseOperationalDayDates, selectedClosedDay, operationalDay?.id])
  const filteredTransactions = useMemo(() => filterRowsByBusinessDate(cashboxTransactions, periodFrom, periodTo), [cashboxTransactions, periodFrom, periodTo])
  const endDayReport = useMemo(() => {
    if (periodFrom !== periodTo) return null
    const day = selectedClosedDay || (operationalDay?.businessDate === periodFrom ? operationalDay : null)
    if (!day) return null
    const settlement = storedSettlement ?? null
    const effective = settlement ? getEffectiveSettlement(settlement, (Array.isArray(settlementCorrections) ? settlementCorrections : []).filter(row => row.settlementId === settlement.id)) : null
    return calculateCashboxDay({
      openingCashBalance: settlement?.openingCashBalance ?? day?.openingCashBalance ?? day?.openingBalance,
      actualCash: effective?.effectiveActualCash ?? settlement?.actualCash,
      sales: filteredSales,
      expenses: filteredExpenses,
      transactions: filteredTransactions,
    })
  }, [periodFrom, periodTo, selectedClosedDay, operationalDay, storedSettlement, settlementCorrections, filteredSales, filteredExpenses, filteredTransactions])
  const normalizedCashOutflows = useMemo(() => normalizeCashOutflowReport({ expenses, transactions: cashboxTransactions, staff, operationalDayDates: expenseOperationalDayDates }), [expenses, cashboxTransactions, staff, expenseOperationalDayDates])
  const filteredCashOutflows = useMemo(() => filterCashOutflowReport(normalizedCashOutflows, periodFrom, periodTo, expenseTypeFilter), [normalizedCashOutflows, periodFrom, periodTo, expenseTypeFilter])
  const managementReport = useMemo(() => buildManagementPaymentsReport({ expenses, transactions: cashboxTransactions, staff, from: periodFrom, to: periodTo, type: managementTypeFilter }), [expenses, cashboxTransactions, staff, periodFrom, periodTo, managementTypeFilter])
  const deliveryDiscountReport = useMemo(() => buildDeliveryDiscountReport(filteredSales, { from: periodFrom, to: periodTo, source: deliverySourceFilter }), [filteredSales, periodFrom, periodTo, deliverySourceFilter])
  const shiftReports = useMemo(() => ({
    morning: buildShiftReport({ sales: filteredSales, expenses: filteredExpenses, transactions: filteredTransactions, businessDate: periodFrom, operationalDayId: (selectedClosedDay || operationalDay)?.id || '', shiftType: 'morning' }),
    evening: buildShiftReport({ sales: filteredSales, expenses: filteredExpenses, transactions: filteredTransactions, businessDate: periodFrom, operationalDayId: (selectedClosedDay || operationalDay)?.id || '', shiftType: 'evening' }),
    endDay: buildEndDayShiftReport({ sales: filteredSales, expenses: filteredExpenses, transactions: filteredTransactions, businessDate: periodFrom, operationalDayId: (selectedClosedDay || operationalDay)?.id || '', openingCashBalance: (selectedClosedDay || operationalDay)?.openingCashBalance ?? (selectedClosedDay || operationalDay)?.openingBalance ?? null }),
  }), [filteredSales, filteredExpenses, filteredTransactions, periodFrom, selectedClosedDay, operationalDay?.id, operationalDay?.openingCashBalance])

  const employeeDataset = useMemo(() => buildEmployeeReport({ staff, sales: reportSales, expenses: filteredExpenses, transactions: cashboxTransactions, from: periodFrom, to: periodTo }), [staff, reportSales, filteredExpenses, cashboxTransactions, periodFrom, periodTo])
  const visibleEmployeeSummaries = useMemo(() => filterEmployeeSummaries(employeeDataset.summaries, employeeQuery), [employeeDataset.summaries, employeeQuery])
  const selectedEmployee = useMemo(() => employeeDataset.summaries.find(row => String(row.employee?.id) === String(selectedEmployeeId)) || null, [employeeDataset.summaries, selectedEmployeeId])
  const captainCandidates = useMemo(() => filterCaptainCandidates(staff, captainQuery), [staff, captainQuery])
  const selectedCaptain = useMemo(() => (Array.isArray(staff) ? staff : []).find(row => String(row.id) === String(selectedCaptainId)) || null, [staff, selectedCaptainId])
  const captainReportData = useMemo(() => buildCaptainReport({ captain: selectedCaptain, staff, sales: reportSales, expenses: filteredExpenses, transactions: cashboxTransactions, from: periodFrom, to: periodTo, sections: captainSections }), [selectedCaptain, staff, reportSales, filteredExpenses, cashboxTransactions, periodFrom, periodTo, captainSections])
  const captainReportDiagnostic = useMemo(() => {
    if (!selectedCaptain) return null
    const keys = new Map()
    const fieldCoverage = Object.fromEntries(['cashierId', 'cashierCode', 'cashierName', 'cashierNameSnapshot', 'seller', 'sellerName', 'createdBy', 'employeeId', 'employeeCode', 'captainId', 'captainCode', 'userId', 'shift'].map(field => [field, 0]))
    const keyOf = row => {
      const values = [row?.cashierNameSnapshot, row?.cashierName, row?.seller, row?.sellerName, row?.cashierCode, row?.employeeCode, row?.cashierId, row?.employeeId, row?.captainCode, row?.captainId].filter(value => value !== undefined && value !== null && String(value).trim() !== '').map(value => String(value).trim())
      return values.join(' / ') || 'غير محدد'
    }
    reportSales.forEach(row => {
      Object.keys(fieldCoverage).forEach(field => { if (row?.[field] !== undefined && row?.[field] !== null && String(row[field]).trim() !== '') fieldCoverage[field] += 1 })
      const key = keyOf(row)
      keys.set(key, (keys.get(key) || 0) + 1)
    })
    const matchedKeys = new Set(captainReportData.matchedSales.filter(row => matchesEmployee(row, selectedCaptain)).map(keyOf))
    const { totals } = captainReportData
    return { selectedName: selectedCaptain.name || '', selectedCode: selectedCaptain.code || '', dateFrom: periodFrom, dateTo: periodTo, matchedSalesCount: captainReportData.matchedSales.length, matchedSalesTotal: totals.totalSales, matchedCashTotal: totals.cashSales, matchedElectronicTotal: totals.electronicSales, matchedExpensesCount: captainReportData.matchedExpenses.length, matchedExpensesTotal: totals.businessExpensesTotal, matchedWithdrawalsCount: captainReportData.matchedWithdrawals.length, matchedWithdrawalsTotal: totals.withdrawalsTotal, summaryTotalSales: totals.totalSales, summaryExpenses: totals.businessExpensesTotal, summaryWithdrawals: totals.withdrawalsTotal, printUsesSameData: 'YES', unmatchedCashierKeys: [...keys.keys()].filter(key => !matchedKeys.has(key)), availableCashierFieldCoverage: fieldCoverage, CAPTAIN_REPORT_RENDER_DIAGNOSTIC: 'YES', CAPTAIN_REPORT_DIAGNOSTIC: 'YES' }
  }, [selectedCaptain, reportSales, periodFrom, periodTo, captainReportData])

  const periodDataset = useMemo(() => {
    if (reportType !== 'period') return EMPTY_PERIOD_DATASET
    const valid = isValidDateRange(periodFrom, periodTo)
    const rangeSales = reportSales
    const normalizedRangeExpenses = filterRowsByBusinessDate((Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates: expenseOperationalDayDates })), periodFrom, periodTo).filter(isActiveExpense)
    const rangeExpenses = normalizedRangeExpenses.filter(isRegularExpense)
    const rangeWithdrawalExpenses = normalizedRangeExpenses.filter(isWithdrawalExpense)
    const rangeTransactions = filterRowsByBusinessDate(cashboxTransactions, periodFrom, periodTo).filter(row => row?.status !== 'voided' && row?.voided !== true)
    const dailyMap = new Map()
    const ensureDay = date => { if (!dailyMap.has(date)) dailyMap.set(date, { businessDate: date, sales: 0, cash: 0, electronic: 0, expenses: 0, withdrawals: 0, deposits: 0, adjustments: 0, net: 0, orders: 0 }); return dailyMap.get(date) }
    rangeSales.forEach(row => { const day = ensureDay(businessDateOf(row)); const value = numberValue(row.total ?? row.subtotal); day.sales += value; day.orders += 1; if ((row.paymentMethod || row.payment?.method) === 'cash') day.cash += value; if ((row.paymentMethod || row.payment?.method) === 'electronic') day.electronic += value })
    rangeExpenses.forEach(row => { ensureDay(businessDateOf(row)).expenses += numberValue(row.amount) })
    rangeTransactions.forEach(row => { const day = ensureDay(businessDateOf(row)); const value = numberValue(row.amount); if (row.type === 'withdrawal') day.withdrawals += value; if (row.type === 'deposit' || row.type === 'return') day.deposits += value; if (row.type === 'adjustment') day.adjustments += numberValue(row.signedAmount ?? row.amount) })
    rangeWithdrawalExpenses.filter(row => !rangeTransactions.some(transaction => String(transaction.linkedExpenseId || transaction.sourceRefId || '') === String(row.id || ''))).forEach(row => { ensureDay(businessDateOf(row)).withdrawals += numberValue(row.amount) })
    const daily = [...dailyMap.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).map(row => ({ ...row, net: row.cash - row.expenses - row.withdrawals + row.deposits + row.adjustments }))
    const grossSales = rangeSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)
    const cashSales = rangeSales.filter(row => (row.paymentMethod || row.payment?.method) === 'cash').reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)
    const electronicSales = rangeSales.filter(row => (row.paymentMethod || row.payment?.method) === 'electronic').reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0)
    const expensesTotal = rangeExpenses.reduce((sum, row) => sum + numberValue(row.amount), 0)
    const cashboxExpenses = rangeExpenses.filter(isCashboxExpense).reduce((sum, row) => sum + numberValue(row.amount), 0)
    const withdrawals = rangeTransactions.filter(row => row.type === 'withdrawal').reduce((sum, row) => sum + numberValue(row.amount), 0) + rangeWithdrawalExpenses.filter(row => !rangeTransactions.some(transaction => String(transaction.linkedExpenseId || transaction.sourceRefId || '') === String(row.id || ''))).reduce((sum, row) => sum + numberValue(row.amount), 0)
    const deposits = rangeTransactions.filter(row => row.type === 'deposit' || row.type === 'return').reduce((sum, row) => sum + numberValue(row.amount), 0)
    const adjustments = rangeTransactions.filter(row => row.type === 'adjustment').reduce((sum, row) => sum + numberValue(row.signedAmount ?? row.amount), 0)
    const beforeTransactions = (Array.isArray(cashboxTransactions) ? cashboxTransactions : []).filter(row => businessDateOf(row) < periodFrom)
    const beforeSales = (Array.isArray(sales) ? sales : []).filter(row => businessDateOf(row) < periodFrom && (row.paymentMethod || row.payment?.method) === 'cash')
    const beforeExpenses = (Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates: expenseOperationalDayDates })).filter(row => businessDateOf(row) < periodFrom && isRegularExpense(row))
    const beforeBalance = calculateCashboxBalance(beforeTransactions) + beforeSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0) - beforeExpenses.reduce((sum, row) => sum + numberValue(row.amount), 0)
    const endTransactions = (Array.isArray(cashboxTransactions) ? cashboxTransactions : []).filter(row => businessDateOf(row) <= periodTo)
    const endSales = (Array.isArray(sales) ? sales : []).filter(row => businessDateOf(row) <= periodTo && (row.paymentMethod || row.payment?.method) === 'cash')
    const endExpenses = (Array.isArray(expenses) ? expenses : []).map(row => normalizeExpense(row, { operationalDayDates: expenseOperationalDayDates })).filter(row => businessDateOf(row) <= periodTo && isRegularExpense(row))
    const endBalance = calculateCashboxBalance(endTransactions) + endSales.reduce((sum, row) => sum + numberValue(row.total ?? row.subtotal), 0) - endExpenses.reduce((sum, row) => sum + numberValue(row.amount), 0)
    const employeeMap = new Map()
    const addEmployee = (row, value, kind) => { const name = row.employeeNameSnapshot || row.cashierNameSnapshot || row.person || row.seller || row.cashierName || 'غير محدد'; const key = String(row.employeeId || row.cashierId || name); const current = employeeMap.get(key) || { name, orders: 0, sales: 0, expenses: 0, withdrawals: 0 }; if (kind === 'sale') { current.orders += 1; current.sales += value } else if (kind === 'withdrawal') current.withdrawals += value; else current.expenses += value; employeeMap.set(key, current) }
    rangeSales.forEach(row => addEmployee(row, numberValue(row.total ?? row.subtotal), 'sale'))
    rangeExpenses.forEach(row => addEmployee(row, numberValue(row.amount), 'expense'))
    rangeTransactions.filter(row => row.type === 'withdrawal').forEach(row => addEmployee(row, numberValue(row.amount), 'withdrawal'))
    return { valid, sales: rangeSales, expenses: rangeExpenses, transactions: rangeTransactions, daily, employees: [...employeeMap.values()], summary: { grossSales, cashSales, electronicSales, expensesTotal, cashboxExpenses, withdrawals, deposits, adjustments, orderCount: rangeSales.length, averageOrder: rangeSales.length ? grossSales / rangeSales.length : 0, netCash: cashSales - cashboxExpenses - withdrawals + deposits + adjustments, beforeBalance, endBalance } }
  }, [periodFrom, periodTo, reportSales, sales, expenses, cashboxTransactions, expenseOperationalDayDates])

  const openPeriodReport = () => {
    if (!isValidDateRange(periodFrom, periodTo)) { setPeriodError('من تاريخ يجب أن يكون قبل أو يساوي إلى تاريخ.'); return }
    setPeriodError('')
    setReportType('period')
  }

  const openEmployeeReport = () => {
    const monthStart = `${defaultBusinessDate.slice(0, 7)}-01`
    setPeriodFrom(monthStart)
    setPeriodTo(defaultBusinessDate)
    setEmployeeQuery('')
    setSelectedEmployeeId('')
    setReportType('employees')
  }

  const printReport = async (format) => {
    try { await onBeforePrint?.() } catch (error) { console.warn('REPORT_PRINT_SYNC_BLOCKED', error?.code || error?.message || String(error)); return }
    const paper = document.querySelector('.captain-report-view .report-paper, .report-view-container .report-paper')
    if (!paper) return

    // Opening the window in the click handler avoids popup blocking.  Copying
    // already-rendered markup preserves React's escaped local data safely.
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      window.alert('تعذر فتح معاينة التقرير. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.')
      return
    }
    const writePrintDocument = () => {
      printWindow.document.open()
      const isA4 = format === 'a4'
      const isMaterials = reportType === 'materials'
      const printStyles = isA4 ? a4PrintStyles : (isMaterials ? thermalMaterialsStyles : thermalComprehensiveStyles)
      printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title></title><style>${printStyles}</style></head><body class="${isA4 ? 'a4-body' : 'thermal-body'}">${paper.outerHTML}</body></html>`)
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
      void waitForAssetsAndPrint()
    }
    // Keep the popup on a standalone document. Navigating it back to the SPA
    // before printing could replace the copied report with the app shell.
    writePrintDocument()
  }

  const printReportDirect = async () => {
    if (!directThermalReady || !onDirectThermalPrint) return
    try { await onBeforePrint?.() } catch (error) { console.warn('REPORT_DIRECT_PRINT_SYNC_BLOCKED', error?.code || error?.message || String(error)); return }
    const titleByType = { comprehensive: 'تقرير شامل', period: 'تقرير الفترة', sales: 'تقرير الطلبات / المبيعات', 'delivery-discounts': 'تقرير خصومات بلي وتوترز', morning: 'تقرير المبيعات - وردية صباحية', evening: 'تقرير المبيعات - وردية مسائية', materials: 'تقرير مبيعات المواد', expenses: 'تقرير المصاريف', management: 'تقرير مدفوعات الإدارة', captain: 'تقرير مبيعات الكابتن' }
    const summary = reportType === 'comprehensive'
      ? calculateComprehensiveSummary(filteredSales, filteredExpenses, filteredTransactions, endDayReport)
      : undefined
    onDirectThermalPrint({ reportType, title: titleByType[reportType] || 'تقرير المبيعات', reportDate: periodFrom, dateFrom: periodFrom, dateTo: periodTo, period: `${periodFrom} إلى ${periodTo}`, sales: filteredSales, expenses: reportType === 'expenses' ? filteredCashOutflows : filteredExpenses, cashOutflows: filteredCashOutflows, ...(reportType === 'materials' ? { products, categories, materials: buildMaterialsReport({ sales: filteredSales, products, categories }) } : {}), ...(summary ? { summary } : {}) })
  }

  const renderReportCards = () => (
    <div className="reports-container" dir="rtl">
      <div className="reports-main">
        {expenseReadError && <div className="settings-notice" role="alert">{expenseReadError}</div>}
        {(session?.status === 'admin-readonly' || ['admin', 'manager', 'super_admin'].includes(session?.role)) && <details className="report-card expense-diagnostic" data-testid="expense-report-diagnostic"><summary>EXPENSE_REPORT_DIAGNOSTIC</summary><pre>{JSON.stringify({ businessDate: periodFrom, operationalDayId: operationalDay?.id || '', shiftType: 'all', cashierId: session?.cashierId || session?.shiftId || '', firebaseExpenseCount: expenseRealtimeMeta.firebaseExpenseCount, localExpenseCount: expenses.length, activeExpenseCount: expenses.filter(isActiveExpense).length, deletedExpenseCount: expenses.filter(row => !isActiveExpense(row)).length, drawerExpenseTotal: sumExpenses(filteredExpenses.filter(isCashboxExpense)), adminExpenseTotal: sumExpenses(filteredExpenses.filter(row => !isCashboxExpense(row))), reportExpenseTotal: sumExpenses(filteredExpenses), lastUpdatedExpenseId: expenseRealtimeMeta.lastUpdatedExpenseId, lastRealtimeUpdateAt: expenseRealtimeMeta.lastRealtimeUpdateAt, REPORT_RECALCULATED: 'YES' }, null, 2)}</pre></details>}
        <div className="reports-header">
          <div><h2>التقارير</h2><p>اختر فترة واحدة لتطبيقها على جميع التقارير.</p></div>
          <button className="outline-btn" onClick={() => onNavigate('dashboard')}>العودة للرئيسية</button>
        </div>
        <div className="reports-range-toolbar" aria-label="فلتر فترة التقارير">
          <label>من تاريخ<input aria-label="من تاريخ" type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} /></label>
          <label>إلى تاريخ<input aria-label="إلى تاريخ" type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} /></label>
          <button className="primary-action" type="button" onClick={openPeriodReport}>عرض التقرير</button>
          <button className="outline-btn" type="button" onClick={openPeriodReport}>طباعة تقرير الفترة</button>
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
          <button className="report-card-btn" onClick={() => setReportType('morning')} data-testid="morning-shift-report-card">
            <Icon name="clock" size={40} />
            <b>تقرير الشفت الصباحي</b>
            <small>مبيعات ومصاريف وردية الصباح</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('evening')} data-testid="evening-shift-report-card">
            <Icon name="clock" size={40} />
            <b>تقرير الشفت المسائي</b>
            <small>مبيعات ومصاريف وردية المساء</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('end-day')} data-testid="end-day-report-card">
            <Icon name="chart" size={40} />
            <b>تقرير نهاية اليوم</b>
            <small>دمج الشفتين وتسوية الصندوق</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('sales')}>
            <Icon name="receipt" size={40} />
            <b>تقرير الطلبات / المبيعات</b>
            <small>كل المبيعات ضمن الفترة المختارة</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('delivery-discounts')} data-testid="delivery-discount-report-card">
            <Icon name="receipt" size={40} />
            <b>تقرير خصومات بلي وتوترز</b>
            <small>من سجل المبيعات المركزي للفترة المختارة</small>
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
          <button className="report-card-btn" onClick={() => setReportType('management')} data-testid="management-payments-report-card">
            <Icon name="wallet" size={40} />
            <b>تقرير مدفوعات الإدارة</b>
            <small>مصاريف وسحوبات الإدارة دون أثر على صندوق POS</small>
          </button>
          <button className="report-card-btn" onClick={() => { setReportType('captain'); setCaptainStage('selection'); setCaptainQuery(''); setSelectedCaptainId(''); setCaptainSections(['sales', 'expenses', 'withdrawals', 'salary']) }}>
            <Icon name="user" size={40} />
            <b>تقرير مبيعات الكابتن</b>
            <small>مبيعات الكباتن ضمن الفترة المختارة</small>
          </button>
          <button className="report-card-btn" onClick={openEmployeeReport} data-testid="employee-report-card">
            <Icon name="user" size={40} />
            <b>تقرير الموظفين</b>
            <small>المصاريف والرواتب والسحوبات والمبالغ على الموظف</small>
          </button>
        </div>
      </div>
    </div>
  )

  const renderEmployeeReport = () => {
    const summary = selectedEmployee
    const money = value => format(value)
    const employeeTable = (rows = visibleEmployeeSummaries) => <>
      <table className="print-table employee-report-table employee-summary-a4" data-testid="employee-summary-table">
      <thead><tr><th>الموظف</th><th>الكود</th><th>المبيعات</th><th>الطلبات</th><th>المصاريف</th><th>الرواتب</th><th>السحوبات</th><th>الإجمالي</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.employee.id} onClick={() => setSelectedEmployeeId(String(row.employee.id))} className="employee-report-row" tabIndex="0" onKeyDown={event => { if (event.key === 'Enter') setSelectedEmployeeId(String(row.employee.id)) }}>
        <td>{row.employee.name}</td><td>{row.employee.code || '—'}</td><td className="number-cell">{money(row.salesTotal)}</td><td className="number-cell">{formatNumber(row.ordersCount)}</td><td className="number-cell">{money(row.expensesTotal)}</td><td className="number-cell">{money(row.salaryTotal)}</td><td className="number-cell">{money(row.withdrawalsTotal)}</td><td className="number-cell">{money(row.employeeTotal)}</td>
      </tr>)}{!rows.length && <tr><td colSpan="8">لا توجد بيانات للموظفين ضمن الفترة المحددة</td></tr>}
      <tr className="summary-highlight"><td colSpan="2">الإجمالي</td><td className="number-cell">{money(employeeDataset.total.salesTotal)}</td><td className="number-cell">{formatNumber(employeeDataset.total.ordersCount)}</td><td className="number-cell">{money(employeeDataset.total.expensesTotal)}</td><td className="number-cell">{money(employeeDataset.total.salaryTotal)}</td><td className="number-cell">{money(employeeDataset.total.withdrawalsTotal)}</td><td className="number-cell">{money(employeeDataset.total.employeeTotal)}</td></tr></tbody>
      </table>
      <div className="employee-summary-thermal" aria-label="ملخص الموظفين الحراري">
        {rows.map(row => <article className="employee-thermal-card" key={`thermal-${row.employee.id}`}>
          <div className="employee-thermal-card-head"><b>{row.employee.name}</b><span>{row.employee.code || '—'}</span></div>
          <div className="employee-thermal-metrics"><span>مبيعات <b dir="ltr">{money(row.salesTotal)}</b></span><span>الطلبات <b dir="ltr">{formatNumber(row.ordersCount)}</b></span><span>مصاريف <b dir="ltr">{money(row.expensesTotal)}</b></span><span>رواتب <b dir="ltr">{money(row.salaryTotal)}</b></span><span>سحوبات <b dir="ltr">{money(row.withdrawalsTotal)}</b></span><span className="employee-thermal-net">الإجمالي <b dir="ltr">{money(row.employeeTotal)}</b></span></div>
        </article>)}
        {!rows.length && <p className="employee-thermal-empty">لا توجد بيانات مالية للموظفين ضمن الفترة المحددة</p>}
        <article className="employee-thermal-card employee-thermal-total"><div className="employee-thermal-card-head"><b>الإجمالي</b></div><div className="employee-thermal-metrics"><span>مبيعات <b dir="ltr">{money(employeeDataset.total.salesTotal)}</b></span><span>الطلبات <b dir="ltr">{formatNumber(employeeDataset.total.ordersCount)}</b></span><span>مصاريف <b dir="ltr">{money(employeeDataset.total.expensesTotal)}</b></span><span>رواتب <b dir="ltr">{money(employeeDataset.total.salaryTotal)}</b></span><span>سحوبات <b dir="ltr">{money(employeeDataset.total.withdrawalsTotal)}</b></span><span className="employee-thermal-net">الإجمالي <b dir="ltr">{money(employeeDataset.total.employeeTotal)}</b></span></div></article>
      </div>
    </>
    const detailRows = (rows, columns, empty) => <table className="print-table"><thead><tr>{columns.map(column => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || `${row.businessDate}-${index}`}>{columns.map(column => <td key={column.label} className={column.number ? 'number-cell' : ''}>{column.value(row, index)}</td>)}</tr>)}{!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}<tr className="summary-row"><td colSpan={Math.max(1, columns.length - 1)}>الإجمالي</td><td className="number-cell">{money(rows.reduce((total, row) => total + Number(row.amount ?? row.total ?? row.subtotal ?? 0), 0))}</td></tr></tbody></table>
    const printContent = summary ? <>
      <h3>ملخص الموظف: {summary.employee.name}</h3>
      <table className="print-table report-summary"><tbody><tr><td>إجمالي المبيعات</td><td className="number-cell">{money(summary.salesTotal)}</td></tr><tr><td>عدد الطلبات</td><td className="number-cell">{formatNumber(summary.ordersCount)}</td></tr><tr><td>مبيعات نقدية</td><td className="number-cell">{money(summary.cashSales)}</td></tr><tr><td>مبيعات إلكترونية</td><td className="number-cell">{money(summary.electronicSales)}</td></tr><tr><td>إجمالي المصاريف</td><td className="number-cell">{money(summary.expensesTotal)}</td></tr><tr><td>إجمالي الرواتب</td><td className="number-cell">{money(summary.salaryTotal)}</td></tr><tr><td>إجمالي السحوبات</td><td className="number-cell">{money(summary.withdrawalsTotal)}</td></tr><tr className="summary-highlight"><td>إجمالي المبالغ على الموظف</td><td className="number-cell">{money(summary.employeeTotal)}</td></tr></tbody></table>
      <h3>المبيعات</h3>{detailRows(summary.sales, [{ label: 'رقم الطلب', value: row => row.orderNumber || row.id || '—' }, { label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'الوقت', value: row => formatTime(row.createdAt || row.timestamp) }, { label: 'الدفع', value: row => (row.paymentMethod || row.payment?.method) === 'electronic' ? 'إلكتروني' : 'نقدي' }, { label: 'المبلغ', value: row => money(row.total ?? row.subtotal), number: true }], 'لا توجد مبيعات')}
      <h3>المصاريف</h3>{detailRows(summary.expenses, [{ label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'المصدر', value: row => row.fundingSource === 'management' ? 'من الإدارة' : 'من الصندوق' }, { label: 'النوع', value: row => row.category || '—' }, { label: 'الوصف', value: row => row.description || row.notes || '—' }, { label: 'المبلغ', value: row => money(row.amount), number: true }], 'لا توجد مصاريف')}
      <h3>الرواتب</h3>{detailRows(summary.salary, [{ label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'المبلغ', value: row => money(row.amount), number: true }, { label: 'الملاحظات', value: row => row.notes || row.description || '—' }], 'لا توجد رواتب')}
      <h3>السحوبات</h3>{detailRows(summary.withdrawals, [{ label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'المصدر', value: row => row.fundingSource === 'management' ? 'من الإدارة' : 'من الصندوق' }, { label: 'المبلغ', value: row => money(row.amount), number: true }, { label: 'الملاحظة', value: row => row.note || row.notes || row.description || '—' }], 'لا توجد سحوبات')}
    </> : employeeTable()
    return <div className="report-view-container employee-report-view" dir="rtl">
      <div className="report-view-header non-printable"><button className="outline-btn" onClick={() => setReportType(null)}>العودة للتقارير</button><div className="report-print-actions"><button className="primary-action" type="button" onClick={() => printReport('thermal')}><Icon name="printer" size={20} /> طباعة حرارية 80mm</button><button className="outline-btn" type="button" onClick={() => printReport('a4')}><Icon name="printer" size={20} /> طباعة A4 / PDF</button></div></div>
      <section className="employee-report-controls non-printable" aria-label="فلترة تقرير الموظفين"><label>ابحث باسم الموظف أو الكود<input value={employeeQuery} onChange={event => setEmployeeQuery(event.target.value)} placeholder="ابحث باسم الموظف أو الكود" /></label><label>اختيار الموظف<select value={selectedEmployeeId} onChange={event => setSelectedEmployeeId(event.target.value)}><option value="">كل الموظفين / تصفية نهاية الشهر</option>{visibleEmployeeSummaries.map(row => <option key={row.employee.id} value={row.employee.id}>{row.employee.name}{row.employee.code ? ` · ${row.employee.code}` : ''}</option>)}</select></label><div className="reports-shortcuts"><button type="button" onClick={() => { setPeriodFrom(`${defaultBusinessDate.slice(0, 7)}-01`); setPeriodTo(defaultBusinessDate) }}>هذا الشهر</button><button type="button" onClick={() => { const previous = shiftDate(`${defaultBusinessDate.slice(0, 7)}-01`, -1); setPeriodFrom(`${previous.slice(0, 7)}-01`); setPeriodTo(previous) }}>الشهر السابق</button><button type="button" onClick={() => { setPeriodFrom(shiftDate(defaultBusinessDate, -29)); setPeriodTo(defaultBusinessDate) }}>آخر 30 يوم</button></div><div className="employee-report-date-range"><label>من تاريخ<input type="date" value={periodFrom} onChange={event => setPeriodFrom(event.target.value)} /></label><label>إلى تاريخ<input type="date" value={periodTo} onChange={event => setPeriodTo(event.target.value)} /></label></div></section>
       <div className="report-paper employee-report-paper"><div className="report-paper-header"><img src={logoUrl} alt="" className="report-logo" /><h2>{summary ? `تقرير موظف: ${summary.employee.name}` : 'تصفية نهاية الشهر - الموظفين'}</h2>{summary && <p>الكود: {summary.employee.code || '—'}</p>}<p>من {periodFrom} إلى {periodTo}</p><p>تاريخ الطباعة: {getDefaultReportDate()} · المستخدم: {session?.name || 'الإدارة'}</p></div>{printContent}</div>
    </div>
  }

  const captainSectionLabels = { sales: 'المبيعات', expenses: 'المصاريف', withdrawals: 'السحوبات', salary: 'الرواتب' }
  const allCaptainSections = Object.keys(captainSectionLabels)
  const setCaptainDateRange = preset => {
    if (preset === 'today') { setPeriodFrom(defaultBusinessDate); setPeriodTo(defaultBusinessDate) }
    if (preset === 'month') { setPeriodFrom(`${defaultBusinessDate.slice(0, 7)}-01`); setPeriodTo(defaultBusinessDate) }
    if (preset === 'previous') { const previous = shiftDate(`${defaultBusinessDate.slice(0, 7)}-01`, -1); setPeriodFrom(`${previous.slice(0, 7)}-01`); setPeriodTo(previous) }
  }
  const renderCaptainSelection = () => (
    <div className="report-view-container captain-report-view" dir="rtl">
      <div className="report-view-header"><button className="outline-btn" onClick={() => setReportType(null)}>العودة للتقارير</button><h2>تقرير الكابتن</h2></div>
      <section className="captain-report-selection" aria-label="اختيار تقرير الكابتن">
        <label>ابحث باسم الكابتن أو الكود<input placeholder="ابحث باسم الكابتن أو الكود" value={captainQuery} onChange={event => setCaptainQuery(event.target.value)} /></label>
        <label>اختيار الكابتن<select aria-label="اختيار الكابتن" value={selectedCaptainId} onChange={event => setSelectedCaptainId(event.target.value)}><option value="">اختر الكابتن</option>{captainCandidates.map(person => <option key={person.id} value={person.id}>{person.name}{person.code ? ` · ${person.code}` : ''}</option>)}</select></label>
        <div className="captain-period-controls"><b>الفترة</b><div className="reports-shortcuts"><button type="button" onClick={() => setCaptainDateRange('today')}>اليوم</button><button type="button" onClick={() => setCaptainDateRange('month')}>هذا الشهر</button><button type="button" onClick={() => setCaptainDateRange('previous')}>الشهر السابق</button></div><div className="employee-report-date-range"><label>من تاريخ<input type="date" value={periodFrom} onChange={event => setPeriodFrom(event.target.value)} /></label><label>إلى تاريخ<input type="date" value={periodTo} onChange={event => setPeriodTo(event.target.value)} /></label></div></div>
        <fieldset className="captain-section-selector"><legend>شنو تريد تعرض؟</legend><label><input type="checkbox" checked={captainSections.length === allCaptainSections.length} onChange={() => setCaptainSections(captainSections.length === allCaptainSections.length ? [] : allCaptainSections)} /> الكل</label>{Object.entries(captainSectionLabels).map(([key, label]) => <label key={key}><input type="checkbox" checked={captainSections.includes(key)} onChange={() => setCaptainSections(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key])} /> {label}</label>)}</fieldset>
        <button className="primary-action" type="button" disabled={!selectedCaptainId || !isValidDateRange(periodFrom, periodTo)} onClick={() => setCaptainStage('report')}>عرض التقرير</button>
      </section>
    </div>
  )

  const renderCaptainReport = () => {
    const detailRows = (rows, columns, empty) => <table className="print-table"><thead><tr>{columns.map(column => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || `${row.businessDate}-${index}`}>{columns.map(column => <td key={column.label} className={column.number ? 'number-cell' : ''}>{column.value(row, index)}</td>)}</tr>)}{!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}<tr className="summary-row"><td colSpan={Math.max(1, columns.length - 1)}>الإجمالي</td><td className="number-cell">{format(rows.reduce((total, row) => total + Number(row.amount ?? row.total ?? row.subtotal ?? 0), 0))}</td></tr></tbody></table>
    const { totals } = captainReportData
    const summary = <><h3>ملخص</h3><table className="print-table report-summary" data-testid="captain-report-summary"><tbody><tr><td>إجمالي المبيعات</td><td className="number-cell">{format(totals.totalSales)}</td></tr><tr><td>إجمالي المصاريف</td><td className="number-cell">{format(totals.businessExpensesTotal)}</td></tr><tr><td>إجمالي السحوبات</td><td className="number-cell">{format(totals.withdrawalsTotal)}</td></tr><tr><td>إجمالي الرواتب</td><td className="number-cell">{format(totals.salariesTotal)}</td></tr><tr><td>النقدي</td><td className="number-cell">{format(totals.cashSales)}</td></tr><tr><td>الإلكتروني</td><td className="number-cell">{format(totals.electronicSales)}</td></tr><tr className="summary-highlight"><td>الصافي</td><td className="number-cell">{format(totals.net)}</td></tr></tbody></table></>
    const content = <>{captainSections.includes('sales') && <><h3>المبيعات</h3>{detailRows(captainReportData.matchedSales, [{ label: 'رقم الطلب', value: row => row.orderNumber || row.id || '—' }, { label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'الوقت', value: row => formatTime(row.createdAt || row.timestamp) }, { label: 'الدفع', value: row => (row.paymentMethod || row.payment?.method) === 'electronic' ? 'إلكتروني' : 'نقدي' }, { label: 'المبلغ', value: row => format(row.total ?? row.subtotal), number: true }], 'لا توجد مبيعات')}{<p className="captain-sales-kpis">الطلبات: {formatNumber(totals.ordersCount)} · نقدي: {format(totals.cashSales)} · إلكتروني: {format(totals.electronicSales)}</p>}</>}{captainSections.includes('expenses') && <><h3>المصاريف</h3>{detailRows(captainReportData.matchedExpenses, [{ label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'الفئة', value: row => row.category || '—' }, { label: 'الوصف', value: row => row.description || row.notes || '—' }, { label: 'المبلغ', value: row => format(row.amount), number: true }], 'لا توجد مصاريف مرتبطة')}</>}{captainSections.includes('withdrawals') && <><h3>السحوبات</h3>{detailRows(captainReportData.matchedWithdrawals, [{ label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'المبلغ', value: row => format(row.amount), number: true }, { label: 'الملاحظة', value: row => row.note || row.notes || row.description || '—' }], 'لا توجد سحوبات مرتبطة')}</>}{captainSections.includes('salary') && <><h3>الرواتب</h3>{detailRows(captainReportData.matchedSalaries, [{ label: 'التاريخ', value: row => businessDateOf(row) }, { label: 'المبلغ', value: row => format(row.amount), number: true }, { label: 'الملاحظات', value: row => row.notes || row.description || '—' }, { label: 'businessDate', value: row => row.businessDate || businessDateOf(row) }], 'لا توجد رواتب مرتبطة')}</>}</>
    return <div className="report-view-container captain-report-view" dir="rtl"><div className="report-view-header non-printable"><button className="outline-btn" onClick={() => setCaptainStage('selection')}>تعديل الاختيار</button><div className="report-print-actions"><button className="primary-action" type="button" data-testid="captain-report-print-thermal" onClick={() => printReport('thermal')}>طباعة حرارية 80mm</button><button className="outline-btn" type="button" data-testid="captain-report-print-a4" onClick={() => printReport('a4')}>طباعة A4 / PDF</button></div></div><div className="report-paper" data-testid="captain-report-paper"><div className="report-paper-header"><h2>تقرير الكابتن: {selectedCaptain?.name || '—'}</h2><p>الكود: {selectedCaptain?.code || '—'}</p><p>من {periodFrom} إلى {periodTo}</p></div>{summary}{content}{(session?.status === 'admin-readonly' || ['admin', 'manager', 'super_admin'].includes(session?.role)) && captainReportDiagnostic && <details className="report-card expense-diagnostic non-printable" data-testid="captain-report-diagnostic"><summary>CAPTAIN_REPORT_RENDER_DIAGNOSTIC</summary><pre>{JSON.stringify(captainReportDiagnostic, null, 2)}</pre>{captainReportDiagnostic.matchedSalesCount === 0 && <p>ALI_102_MATCHING_SALES_COUNT=0 — available cashier keys: {captainReportDiagnostic.unmatchedCashierKeys.join('، ') || 'لا توجد'}</p>}</details>}</div></div>
  }

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

    if (reportType === 'morning' || reportType === 'evening' || reportType === 'end-day') {
      const isEndDay = reportType === 'end-day'
      const selectedShift = reportType === 'morning' ? shiftReports.morning : shiftReports.evening
      const report = isEndDay ? shiftReports.endDay : selectedShift
      title = isEndDay ? 'تقرير نهاية اليوم' : `تقرير الشفت ${selectedShift.shiftLabel}`
      const shiftRows = shift => <table className="print-table report-summary"><tbody>
        <tr><td>عدد الطلبات</td><td className="number-cell">{formatNumber(shift.ordersCount)}</td></tr>
        <tr><td>إجمالي المبيعات</td><td className="number-cell">{format(shift.totalSales)}</td></tr>
        <tr><td>مبيعات الكاش</td><td className="number-cell">{format(shift.cashSales)}</td></tr>
        <tr><td>المبيعات الإلكترونية</td><td className="number-cell">{format(shift.electronicSales)}</td></tr>
        <tr><td>الخصومات</td><td className="number-cell">{format(shift.discounts)}</td></tr>
        <tr><td>مصاريف من الصندوق</td><td className="number-cell">{format(shift.drawerExpenses)}</td></tr>
        <tr><td>السحوبات</td><td className="number-cell">{format(shift.withdrawalsTotal)}</td></tr>
        <tr className="summary-highlight"><td>إجمالي النقدي الخارج من الصندوق</td><td className="number-cell">{format(shift.drawerExpenses + shift.withdrawalsTotal)}</td></tr>
        <tr className="summary-highlight"><td>صافي الكاش للشفت</td><td className="number-cell">{format(shift.netCash)}</td></tr>
        <tr><td>المبيعات الملغاة / المبطلة</td><td className="number-cell">{formatNumber(shift.voidedCount)}</td></tr>
        <tr><td>الكاشير</td><td>{shift.cashierNames.join('، ') || 'غير محدد'}</td></tr>
        <tr><td>النطاق الزمني</td><td>{shift.timeRange.from ? `${formatDateTime(shift.timeRange.from)} — ${formatDateTime(shift.timeRange.to)}` : 'لا توجد حركات'}</td></tr>
      </tbody></table>
      content = isEndDay ? <>
        <h3>ملخص الشفت الصباحي</h3>{shiftRows(report.morning)}
        <h3>ملخص الشفت المسائي</h3>{shiftRows(report.evening)}
        <h3>إجمالي اليوم</h3><table className="print-table report-summary"><tbody>
          <tr><td>إجمالي المبيعات</td><td className="number-cell">{format(report.totalSales)}</td></tr><tr><td>النقدي</td><td className="number-cell">{format(report.cashSales)}</td></tr><tr><td>الإلكتروني</td><td className="number-cell">{format(report.electronicSales)}</td></tr><tr><td>الخصومات</td><td className="number-cell">{format(report.discounts)}</td></tr><tr><td>المصاريف</td><td className="number-cell">{format(report.expenses)}</td></tr><tr><td>السحوبات</td><td className="number-cell">{format(report.withdrawals)}</td></tr><tr><td>الإيداعات</td><td className="number-cell">{format(report.deposits)}</td></tr>
          <tr className="summary-highlight"><td>مبلغ الصندوق المتوقع بنهاية اليوم</td><td className="number-cell">{report.expectedFinalDrawer == null ? 'غير متوفر' : format(report.expectedFinalDrawer)}</td></tr>
        </tbody></table>
      </> : shiftRows(report)
    } else if (reportType === 'delivery-discounts') {
      title = 'تقرير خصومات بلي وتوترز'
      const total = deliveryDiscountReport.totals.overall
      const summary = source => deliveryDiscountReport.totals[source]
      content = <>
        <div className="reports-range-toolbar non-printable" aria-label="فلتر مصدر تقرير الخصومات"><label>المصدر<select aria-label="مصدر الخصم" value={deliverySourceFilter} onChange={event => setDeliverySourceFilter(event.target.value)}><option value="all">بلي وتوترز</option><option value="baly">بلي</option><option value="toters">توترز</option></select></label><span>الفترة: {periodFrom} إلى {periodTo}</span></div>
        <table className="print-table report-summary" data-testid="delivery-discount-summary"><tbody>{['baly', 'toters'].map(source => <tr key={source}><td>{deliverySourceLabel(source)} · الطلبات</td><td className="number-cell">{formatNumber(summary(source).count)}</td><td>{format(summary(source).discount)}</td></tr>)}<tr className="summary-highlight"><td>الإجمالي العام · {formatNumber(total.count)} طلب</td><td className="number-cell">{format(total.discount)}</td><td>{format(total.finalTotal)}</td></tr></tbody></table>
        <table className="print-table delivery-discount-table" data-testid="delivery-discount-report"><thead><tr><th>businessDate</th><th>رقم الطلب</th><th>المصدر</th><th>قبل الخصم</th><th>الخصم</th><th>%</th><th>بعد الخصم</th><th>الدفع</th><th>الكاشير</th><th>createdAt</th></tr></thead><tbody>{deliveryDiscountReport.rows.map(row => <tr key={row.id}><td>{row.businessDate}</td><td>{row.orderNumber}</td><td>{row.sourceLabel}</td><td className="number-cell">{format(row.originalTotal)}</td><td className="number-cell">{format(row.discount)}</td><td className="number-cell">{row.discountPercent.toFixed(2)}%</td><td className="number-cell">{format(row.finalTotal)}</td><td>{row.paymentMethod === 'cash' ? 'نقدي' : 'إلكتروني'}</td><td>{row.cashier}</td><td>{row.createdAt ? formatDate(row.createdAt) : '—'}</td></tr>)}{!deliveryDiscountReport.rows.length && <tr><td colSpan="10">لا توجد طلبات بلي أو توترز ضمن الفترة المحددة</td></tr>}<tr className="summary-row"><td colSpan="4">الإجمالي</td><td className="number-cell">{format(total.discount)}</td><td>—</td><td className="number-cell">{format(total.finalTotal)}</td><td colSpan="3">{formatNumber(total.count)} طلب</td></tr></tbody></table>
      </>
    } else if (reportType === 'period') {
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
      const summary = calculateComprehensiveSummary(filteredSales, filteredExpenses, filteredTransactions, endDayReport)
      const { grossSales, discounts, expenses: expensesTotal, cashboxExpenses, managementExpenses, netAfterDiscount, netAfterExpenses, netAfterExpensesAndDiscount, netCashAfterAll, cashSales, electronicSales, cashboxWithdrawals, managementWithdrawals, withdrawals, deposits, finalAfterAllSettlements, finalNetSaleWithoutOpening, cashOnlyNetWithoutOpening } = summary
      const actualCashMissingLabel = selectedClosedDay ? 'غير مسجل في هذا التقرير القديم' : ACTUAL_CASH_PENDING
      const actualCashValue = hasActualCash(summary.actualCash) ? format(toMoneyNumber(summary.actualCash, 0)) : actualCashMissingLabel
      const actualDifferenceValue = summary.endDayDifference == null ? actualCashMissingLabel : `${format(toMoneyNumber(summary.endDayDifference, 0))} ${summary.endDayDifference === 0 ? 'مطابق' : summary.endDayDifference < 0 ? 'نقص' : 'زيادة'}`
      const netDrawerMovementValue = summary.netDrawerMovement == null ? actualCashMissingLabel : format(toMoneyNumber(summary.netDrawerMovement, 0))
      const netCashSalesValue = summary.netCashSalesFromDrawer == null ? actualCashMissingLabel : format(toMoneyNumber(summary.netCashSalesFromDrawer, 0))
      const cashSalesDifferenceValue = summary.cashSalesDifference == null ? actualCashMissingLabel : `${format(toMoneyNumber(summary.cashSalesDifference, 0))} ${summary.cashSalesDifferenceStatus === 'matched' ? 'مطابق' : summary.cashSalesDifferenceStatus === 'short' ? 'نقص' : 'زيادة'}`
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
            <tr className="summary-section"><th colSpan="2">ملخص المبيعات</th></tr>
            <tr><td>إجمالي المبيعات</td><td className="number-cell">{format(grossSales)}</td></tr>
            <tr><td>إجمالي الخصومات</td><td className="number-cell">{format(discounts)}</td></tr>
            <tr className="summary-highlight"><td>صافي البيع بعد الخصومات</td><td className="number-cell">{format(netAfterDiscount)}</td></tr>
            <tr className="summary-section"><th colSpan="2">طرق الدفع</th></tr>
            <tr><td>النقدي</td><td className="number-cell">{format(toMoneyNumber(cashSales, 0))}</td></tr>
            <tr><td>الإلكتروني</td><td className="number-cell">{format(toMoneyNumber(electronicSales, 0))}</td></tr>
            <tr className="summary-section"><th colSpan="2">الصندوق</th></tr>
            <tr><td>الرصيد الافتتاحي</td><td className="number-cell">{summary.openingCashBalance == null ? 'غير متوفر' : format(toMoneyNumber(summary.openingCashBalance, 0))}</td></tr>
            <tr><td>مبيعات الكاش</td><td className="number-cell">{format(toMoneyNumber(cashSales, 0))}</td></tr>
            <tr><td>المصاريف</td><td className="number-cell">{format(toMoneyNumber(expensesTotal, 0))}</td></tr>
            <tr><td>السحوبات</td><td className="number-cell">{format(toMoneyNumber(withdrawals, 0))}</td></tr>
            <tr><td>الإيداعات</td><td className="number-cell">{format(toMoneyNumber(deposits, 0))}</td></tr>
            <tr className="summary-highlight"><td>الرصيد المتوقع بالصندوق</td><td className="number-cell">{summary.expectedClosingCash == null ? 'غير متوفر' : format(toMoneyNumber(summary.expectedClosingCash, 0))}</td></tr>
            <tr className="summary-section"><th colSpan="2">الجرد / الإغلاق</th></tr>
            <tr><td>الكاش الفعلي</td><td className="number-cell">{actualCashValue}</td></tr>
            <tr><td>الفرق</td><td className="number-cell">{actualDifferenceValue}</td></tr>
            <tr className="summary-section"><th colSpan="2">الصافي النهائي</th></tr>
            <tr><td>صافي الكاش بعد المصاريف والسحوبات بدون الرصيد الافتتاحي</td><td className="number-cell">{format(toMoneyNumber(cashOnlyNetWithoutOpening, 0))}</td></tr>
            <tr className="summary-highlight"><td>صافي البيع النهائي بعد كلشي بدون الرصيد الافتتاحي</td><td className="number-cell">{format(toMoneyNumber(finalNetSaleWithoutOpening, 0))}</td></tr>
          </tbody>
        </table>

        <h3>تفاصيل إضافية</h3>
        <table className="print-table report-summary">
          <tbody>
            <tr><td>صافي البيع بعد المصاريف</td><td className="number-cell">{format(toMoneyNumber(netAfterExpenses, 0))}</td></tr>
            <tr><td>صافي البيع بعد المصاريف والخصومات</td><td className="number-cell">{format(toMoneyNumber(netAfterExpensesAndDiscount, 0))}</td></tr>
            <tr><td>صافي البيع بدون الإلكتروني والمصاريف والخصومات</td><td className="number-cell">{format(toMoneyNumber(netCashAfterAll, 0))}</td></tr>
            <tr><td>صافي حركة الصندوق بعد خصم الرصيد الافتتاحي</td><td className="number-cell">{netDrawerMovementValue}</td></tr>
            <tr><td>صافي مبيعات اليوم النقدية</td><td className="number-cell">{netCashSalesValue}</td></tr>
            <tr><td>فرق المبيعات النقدية</td><td className="number-cell">{cashSalesDifferenceValue}</td></tr>
            <tr><td>مصاريف من الصندوق</td><td className="number-cell">{format(toMoneyNumber(cashboxExpenses, 0))}</td></tr>
            <tr><td>مصاريف من الإدارة</td><td className="number-cell">{format(toMoneyNumber(managementExpenses, 0))}</td></tr>
            <tr><td>سحوبات من الصندوق</td><td className="number-cell">{format(toMoneyNumber(cashboxWithdrawals, 0))}</td></tr>
            <tr><td>سحوبات من الإدارة</td><td className="number-cell">{format(toMoneyNumber(managementWithdrawals, 0))}</td></tr>
            <tr className="summary-highlight"><td>إجمالي النقدي الخارج من الصندوق</td><td className="number-cell">{format(toMoneyNumber(cashboxExpenses, 0) + toMoneyNumber(cashboxWithdrawals, 0))}</td></tr>
            <tr><td>إجمالي الخدمة</td><td className="number-cell">{format(toMoneyNumber(totalServiceCharge, 0))}</td></tr>
            <tr><td>إجمالي التسديدات</td><td className="number-cell">{format(0)}</td></tr>
            <tr><td>المجموع بعد كل التصفيات</td><td className="number-cell">{format(toMoneyNumber(finalAfterAllSettlements, 0))}</td></tr>
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
      title = 'تقرير المصاريف والسحوبات'
      const cashOutflowSummary = summarizeCashOutflowReport(filteredCashOutflows)
      const renderRows = rows => rows.map((row, idx) => (
        <tr key={`${row.source}:${row.id}:${idx}`}>
          <td>{row.businessDate || '—'}</td><td>{row.typeLabel}</td><td>{row.description || row.notes || '—'}</td><td>{row.employeeName || 'غير محدد'}</td><td>{row.employeeCode || '—'}</td><td>{format(row.amount)}</td><td>{row.sourceLabel || (row.source === 'expense' ? 'المصاريف' : row.source || '—')}</td><td>{row.shiftLabel || (row.shiftType === 'morning' ? 'صباحي' : row.shiftType === 'evening' ? 'مسائي' : 'غير محدد')}</td>
        </tr>
      ))
      const renderSection = (heading, rows, emptyLabel) => <section className="report-subsection"><h3>{heading}</h3><table className="print-table" data-testid={heading === 'السحوبات' ? 'withdrawals-report' : 'shop-expenses-report'}><thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>الموظف / الكاشير</th><th>الكود</th><th>المبلغ</th><th>المصدر</th><th>الشفت</th></tr></thead><tbody>{rows.length ? renderRows(rows) : <tr><td colSpan="8">{emptyLabel}</td></tr>}<tr style={{ fontWeight: 'bold' }}><td colSpan="6">إجمالي {heading}</td><td>{format(sumCashOutflowReport(rows))}</td><td>—</td></tr></tbody></table></section>
      content = (
        <>
        <div className="reports-range-toolbar non-printable" aria-label="فلتر نوع حركة المصاريف">
          <label>نوع الحركة<select aria-label="نوع الحركة" value={expenseTypeFilter} onChange={event => setExpenseTypeFilter(event.target.value)}><option value="all">الكل</option><option value="expenses">مصاريف</option><option value="salary">رواتب</option><option value="withdrawals">سحوبات</option><option value="other">أخرى</option></select></label>
        </div>
        {expenseTypeFilter !== 'withdrawals' && renderSection('مصاريف المحل', cashOutflowSummary.expenses, 'لا توجد مصاريف محل ضمن الفترة المحددة')}
        {expenseTypeFilter === 'all' || expenseTypeFilter === 'withdrawals' ? renderSection('السحوبات', cashOutflowSummary.withdrawals, 'لا توجد سحوبات ضمن الفترة المحددة') : null}
        <table className="print-table report-summary" data-testid="cash-outflow-summary"><tbody><tr><td>مصاريف المحل</td><td>{format(cashOutflowSummary.normalBusinessExpensesTotal)}</td></tr><tr><td>السحوبات</td><td>{format(cashOutflowSummary.withdrawalsTotal)}</td></tr><tr className="summary-highlight"><td>إجمالي الخارج من الصندوق = المصاريف + السحوبات</td><td>{format(cashOutflowSummary.cashOutTotal)}</td></tr></tbody></table>
        </>
      )
    } else if (reportType === 'management') {
      title = 'تقرير مدفوعات الإدارة'
      content = <>
        <div className="reports-range-toolbar non-printable" aria-label="فلاتر تقرير مدفوعات الإدارة">
          <label>النوع<select value={managementTypeFilter} onChange={event => setManagementTypeFilter(event.target.value)}><option value="all">الكل</option><option value="expenses">مصاريف</option><option value="withdrawals">سحوبات</option></select></label>
          <span>الفترة: {periodFrom} إلى {periodTo}</span>
        </div>
        <table className="print-table report-summary" data-testid="management-payments-summary"><tbody><tr><td>إجمالي مصاريف الإدارة</td><td className="number-cell">{format(managementReport.managementExpenses)}</td></tr><tr><td>إجمالي سحوبات الإدارة</td><td className="number-cell">{format(managementReport.managementWithdrawals)}</td></tr><tr className="summary-highlight"><td>إجمالي مدفوعات الإدارة</td><td className="number-cell">{format(managementReport.managementTotal)}</td></tr></tbody></table>
        <table className="print-table" data-testid="management-payments-report"><thead><tr><th>التاريخ</th><th>الوقت</th><th>النوع</th><th>الموظف</th><th>التصنيف</th><th>البيان</th><th>المبلغ</th><th>اليوم التشغيلي</th></tr></thead><tbody>{managementReport.rows.map(row => <tr key={row.id}><td>{row.businessDate || '—'}</td><td>{row.createdAt ? formatTime(row.createdAt) : '—'}</td><td>{row.typeLabel}</td><td>{row.employeeName || '—'}</td><td>{row.category || '—'}</td><td>{row.description || '—'}</td><td className="number-cell">{format(row.amount)}</td><td>{row.operationalDay || '—'}</td></tr>)}{!managementReport.rows.length && <tr><td colSpan="8">لا توجد مدفوعات إدارة ضمن الفترة المحددة</td></tr>}<tr className="summary-row"><td colSpan="6">الإجمالي</td><td className="number-cell">{format(managementReport.managementTotal)}</td><td>—</td></tr></tbody></table>
      </>
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
          <div className="report-paper-header" data-report-source={reportSource}>
            <img src={logoUrl} alt="" className="report-logo" />
            <h2>{title}</h2>
            <p>من {periodFrom} إلى {periodTo}</p>
            <p>تاريخ الطباعة: {getDefaultReportDate()} · المستخدم: {session?.name || session?.shiftName || 'الإدارة'}</p>
            {postCloseDrift && <p className="form-error" role="alert">تنبيه: توجد فروقات بين بيانات اليوم الحالية والتسوية الأصلية.</p>}
          </div>
          
          {content}
          
          <div className="report-paper-footer">
            <p>شكراً لكم</p>
          </div>
        </div>
      </div>
    )
  }

  if (reportType === 'employees') return renderEmployeeReport()
  if (reportType === 'captain') return captainStage === 'selection' ? renderCaptainSelection() : renderCaptainReport()
  return reportType ? renderPrintableReport() : renderReportCards()
}

export default function Reports(props) {
  return <ReportsErrorBoundary><ReportsView {...props} /></ReportsErrorBoundary>
}
