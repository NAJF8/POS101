import React, { useEffect, useState, useMemo } from 'react'
import { Icon } from './Icons'
import { loadAccReports } from '../services/accSync'
import { logoDataUri } from '../assets/logo'

const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
// Reports print in their own A4 or thermal 80mm document.
const logoUrl = logoDataUri || `${import.meta.env.BASE_URL}assets/branding/101-logo-transparent.png`
const formatDateTime = value => {
  if (!value) return '—'
  const d = new Date(value)
  const datePart = d.toLocaleDateString('en-CA')
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart} ${timePart}`
}
const formatDate = value => formatDateTime(value)

const a4PrintStyles = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif; }
  body { direction: rtl; font-size: 12pt; line-height: 1.5; }
  .report-paper { width: 100%; max-width: none; margin: 0; padding: 0; background: #fff; }
  .report-paper-header { text-align: center; padding-bottom: 6mm; margin-bottom: 7mm; border-bottom: .4mm solid #40533b; }
  .report-logo { display: block; width: 40mm; height: 29mm; object-fit: contain; margin: 0 auto 3mm; filter: brightness(0); }
  h2 { margin: 0 0 2mm; font-size: 20pt; color: #000; }
  h3 { margin: 7mm 0 3mm; font-size: 15pt; color: #000; }
  p { margin: 0; }
  .print-table { width: 100%; border-collapse: collapse; margin: 0 0 6mm; }
  .print-table th, .print-table td { border: .35mm solid #000; padding: 2.8mm; color: #000; text-align: right; vertical-align: top; }
  .print-table th { background: #fff; color: #000; font-weight: 800; }
  .print-table tfoot td { background: #fff; color: #000; font-weight: 800; }
  .number-cell { direction: ltr; text-align: left; white-space: nowrap; }
  .report-paper-footer { display: flex; justify-content: space-between; gap: 6mm; padding-top: 4mm; margin-top: 7mm; border-top: .35mm solid #000; color: #000; font-weight: 800; }
  thead { display: table-header-group; }
  tr, .report-paper-header, .report-paper-footer { break-inside: avoid; page-break-inside: avoid; }
`

// Match the thermal receipt's proven 80mm print settings. This is injected
// into the isolated print window only for the comprehensive report.
const thermalComprehensiveStyles = `
  @page { margin: 0; size: 80mm auto; }
  * { box-sizing: border-box; }
  html, body { width: 80mm !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; position: static !important; background: #fff; color: #000; }
  body { direction: rtl; font-family: Tahoma, 'Arial Unicode MS', Arial, sans-serif; font-size: 10.5pt; font-weight: 600; line-height: 1.3; }
  .report-paper { width: 72mm; margin: 0 auto; padding: 1.5mm 0 4mm; background: #fff; color: #000; box-sizing: border-box; }
  .report-paper-header { text-align: center; padding: 0 0 1.5mm; margin: 0 0 1.5mm; border-bottom: .35mm solid #000; color: #000; break-inside: avoid; page-break-inside: avoid; }
  .report-logo { display: block; width: 24mm; height: 24mm; max-width: 100%; object-fit: contain; margin: 0 auto 1.5mm; filter: brightness(0); }
  h2 { margin: 0 0 1.5mm; color: #000; font-size: 16pt; font-weight: 800; line-height: 1.2; }
  h3 { margin: 2.5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: .3mm solid #000; color: #000; font-size: 12.5pt; font-weight: 800; break-after: avoid; page-break-after: avoid; }
  p { margin: 0; color: #000; }
  .report-paper-header > p { font-size: 9.5pt; font-weight: 700; }
  .print-table { width: 100%; margin: 0 0 3mm; border: .35mm solid #000; border-collapse: collapse; color: #000; table-layout: auto; }
  .print-table th, .print-table td { border: .3mm solid #000; padding: 1.5mm 1mm; color: #000; text-align: center; vertical-align: middle; font-size: 9.5pt; font-weight: 600; overflow-wrap: anywhere; word-break: break-word; }
  .print-table th { font-weight: 800; }
  .print-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .print-table td:first-child { font-weight: 800; }
  .print-table .number-cell { direction: rtl; text-align: center; white-space: normal; }
  .report-summary { break-inside: avoid; page-break-inside: avoid; }
  .report-summary tbody tr:nth-child(7) td, .report-summary tbody tr:nth-child(8) td { font-size: 12pt; font-weight: 900; border-top: .6mm solid #000; border-bottom: .6mm solid #000; }
  .summary-highlight td, tr.summary-highlight td { font-size: 12pt !important; font-weight: 900 !important; border-top: .6mm solid #000 !important; border-bottom: .6mm solid #000 !important; }
  .summary-negative td, tr.summary-negative td { font-size: 11pt !important; font-weight: 900 !important; border-top: .4mm solid #000 !important; }
  .summary-row td, tr.summary-row td { font-weight: 900 !important; border-top: .4mm solid #000 !important; }
  
  .thermal-cards-list { display: flex; flex-direction: column; gap: 2mm; margin-bottom: 3mm; }
  .thermal-sale-card { display: flex; flex-direction: column; border: .35mm solid #000; padding: 1.5mm; break-inside: avoid; page-break-inside: avoid; }
  .thermal-card-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: .2mm dashed #555; padding-bottom: 1mm; margin-bottom: 1mm; }
  .thermal-card-head .order-no { font-size: 10pt; font-weight: 800; color: #000; }
  .thermal-card-head .order-dt { font-size: 8.5pt; font-weight: 700; color: #222; }
  .thermal-card-body { display: flex; justify-content: space-between; font-size: 8.5pt; color: #111; margin-bottom: 1mm; }
  .thermal-card-foot { display: flex; justify-content: space-between; align-items: center; background: #fdfdfd; border-top: .2mm dashed #555; padding-top: 1mm; font-size: 10pt; font-weight: 900; color: #000; }
  .thermal-cards-total { display: flex; justify-content: space-between; font-size: 11pt; font-weight: 900; border-top: .5mm solid #000; padding-top: 1.5mm; margin-bottom: 3mm; }

  .thermal-product-table th:first-child, .thermal-product-table td:first-child { width: 7mm; text-align: center; }
  .thermal-product-table th:nth-child(2), .thermal-product-table td:nth-child(2) { text-align: right; }
  .thermal-product-table td:last-child, .thermal-captain-table td:last-child { white-space: nowrap; }
  .report-paper-footer { display: flex; flex-direction: column; align-items: center; gap: 1mm; padding-top: 2mm; margin-top: 3mm; border-top: .35mm solid #000; color: #000; font-size: 9pt; font-weight: 800; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`

// The sold-materials report is its own compact thermal document. It is not
// the comprehensive report and deliberately contains only item aggregates.
const thermalMaterialsStyles = `
  @page { margin: 0; size: 80mm auto; }
  * { box-sizing: border-box; }
  html, body { width: 80mm !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; position: static !important; background: #fff; color: #000; }
  body { direction: rtl; font-family: Tahoma, 'Arial Unicode MS', Arial, sans-serif; font-size: 10.5pt; font-weight: 600; line-height: 1.3; }
  .report-paper { width: 72mm; margin: 0 auto; padding: 1.5mm 0 4mm; background: #fff; box-sizing: border-box; }
  .report-paper-header { text-align: center; padding: 0 0 1.5mm; margin: 0 0 1.5mm; border-bottom: .35mm solid #000; break-inside: avoid; }
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

export default function Reports({ onNavigate, session, onDirectThermalPrint, directThermalReady = false }) {
  const [reportType, setReportType] = useState(null)
  const [remote, setRemote] = useState(null)
  
  const todayStr = new Date().toISOString().substring(0, 10)
  const [dateFrom, setDateFrom] = useState(todayStr)
  const [dateTo, setDateTo] = useState(todayStr)
  
  useEffect(() => {
    if (!session?.profile) return undefined
    let active = true
    loadAccReports().then(data => { if (active) setRemote(data) }).catch(() => {})
    return () => { active = false }
  }, [session])

  const sales = useMemo(() => remote ? remote.sales.map(row => ({ ...row, id: row.id, createdAt: Date.parse(row.created_at || row.date) || 0, total: Number(row.total_after_discount || 0), discount: Number(row.discount_amount || 0), paymentMethod: row.payment_method, shift: row.shift_id, order: { items: row.items || [] } })) : read('pos101.sales', []), [remote])
  const expenses = useMemo(() => remote ? remote.expenses.map(row => ({ ...row, date: Date.parse(row.date || row.created_at) || 0, amount: Number(row.amount || 0), shift: row.shift_id, notes: row.description })) : read('pos101.expenses', []), [remote])

  const startMs = new Date(dateFrom).setHours(0, 0, 0, 0)
  const endMs = new Date(dateTo).setHours(23, 59, 59, 999)

  const filteredSales = useMemo(() => {
    return sales.filter(s => s.createdAt >= startMs && s.createdAt <= endMs && (!s.voided))
  }, [sales, startMs, endMs])

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => e.date >= startMs && e.date <= endMs)
  }, [expenses, startMs, endMs])

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
    const titleByType = { comprehensive: 'تقرير شامل', morning: 'تقرير المبيعات - وردية صباحية', evening: 'تقرير المبيعات - وردية مسائية', materials: 'تقرير المواد المباعة', expenses: 'تقرير المصاريف', captain: 'تقرير مبيعات الكابتن' }
    onDirectThermalPrint({ reportType, title: titleByType[reportType] || 'تقرير المبيعات', dateFrom, dateTo, period: `${dateFrom} - ${dateTo}`, sales: filteredSales, expenses: filteredExpenses })
  }

  const renderReportCards = () => (
    <div className="reports-container" dir="rtl">
      <div className="reports-sidebar">
        <div className="date-filter">
          <h3>اختيار المدة</h3>
          <label>من تاريخ<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
          <label>إلى تاريخ<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
        </div>
      </div>
      
      <div className="reports-main">
        <div className="reports-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2>التقارير</h2>
          <button className="outline-btn" onClick={() => onNavigate('dashboard')}>العودة للرئيسية</button>
        </div>
        
        <div className="reports-grid">
          <button className="report-card-btn" onClick={() => setReportType('comprehensive')}>
            <Icon name="file-text" size={40} />
            <b>تقرير شامل (صباحي ومسائي)</b>
            <small>جميع المبيعات والمصاريف على فترة محددة</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('morning')}>
            <Icon name="sun" size={40} />
            <b>تقرير صباحي</b>
            <small>مبيعات الوردية الصباحية</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('evening')}>
            <Icon name="moon" size={40} />
            <b>تقرير مسائي</b>
            <small>مبيعات الوردية المسائية</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('materials')}>
            <Icon name="box" size={40} />
            <b>تقرير المواد</b>
            <small>المواد المباعة وكمياتها</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('expenses')}>
            <Icon name="wallet" size={40} />
            <b>تقرير المصاريف</b>
            <small>جميع المصاريف المسجلة من الكاشير</small>
          </button>
          <button className="report-card-btn" onClick={() => setReportType('captain')}>
            <Icon name="user" size={40} />
            <b>تقرير مبيعات الكابتن</b>
            <small>مبيعات كل كابتن (علي - روان - محمد - ميس)</small>
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
      const gross = sList.reduce((acc, s) => acc + s.subtotal, 0)
      const discounts = sList.reduce((acc, s) => acc + s.discount, 0)
      
      // Calculate refunds explicitly from adjustments
      const refunds = sList.reduce((acc, s) => {
        if (!s.order?.adjustments) return acc;
        return acc + s.order.adjustments.filter(a => a.type === 'refund').reduce((sum, a) => sum + (a.amount || 0), 0)
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
            <div className="thermal-sale-card" key={sale.id || `${sale.orderNumber}-${sale.createdAt}`}>
              <div className="thermal-card-head">
                <b className="order-no">طلب #{sale.orderNumber || index + 1}</b>
                <span className="order-dt" dir="ltr">{formatDateTime(sale.createdAt)}</span>
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
            {[...products.entries()].sort((a, b) => b[1].quantity - a[1].quantity).map(([name, row]) => <tr key={name}><td>{name}</td><td>{row.quantity}</td><td>{format(row.total)}</td></tr>)}
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
            {[...captains.entries()].map(([name, row]) => <tr key={name}><td>{name}</td><td>{row.count}</td><td>{format(row.total)}</td></tr>)}
            {!captains.size && <tr><td colSpan="3">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
          </tbody>
        </table>
      </section>
    }

    if (reportType === 'comprehensive') {
      title = 'تقرير شامل'
      const stats = aggregateSales(filteredSales)
      const expensesTotal = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
      const totalRevenue = filteredSales.reduce((sum, s) => sum + Number(s.total || 0), 0)
      const totalServiceCharge = filteredSales.reduce((sum, s) => sum + Number(s.service || 0), 0)
      const netBalance = totalRevenue - expensesTotal

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
            <tr><td>إجمالي المبيعات</td><td className="number-cell">{format(stats.gross)}</td></tr>
            <tr><td>إجمالي المصاريف</td><td className="number-cell">{format(expensesTotal)}</td></tr>
            <tr><td>إجمالي الإيرادات</td><td className="number-cell">{format(totalRevenue)}</td></tr>
            <tr><td>إجمالي الخصم</td><td className="number-cell">{format(stats.discounts)}</td></tr>
            <tr><td>إجمالي الخدمة</td><td className="number-cell">{format(totalServiceCharge)}</td></tr>
            <tr><td>إجمالي التسديدات</td><td className="number-cell">{format(0)}</td></tr>
            <tr className="summary-highlight"><td>صافي البيع</td><td className="number-cell">{format(totalRevenue)}</td></tr>
            <tr className="summary-negative"><td>صافي الوارد</td><td className="number-cell">{format(netBalance < 0 ? netBalance : -1 * (expensesTotal - totalRevenue > 0 ? expensesTotal - totalRevenue : 0))}</td></tr>
          </tbody>
        </table>

        {/* ── Product Details Section ── */}
        <h3>تفاصيل المبيعات</h3>
        <table className="print-table thermal-product-table">
          <thead><tr><th>ت</th><th>اسم المادة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {productList.map(([name, row], idx) => (
              <tr key={name}><td>{idx + 1}</td><td>{name}</td><td>{row.quantity}</td><td className="number-cell">{format(row.total)}</td></tr>
            ))}
            {!productList.length && <tr><td colSpan="4">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
            <tr className="summary-row"><td colSpan="2">إجمالي المبيعات</td><td>{totalProductQty}</td><td className="number-cell">{format(totalProductAmt)}</td></tr>
            <tr className="summary-row"><td colSpan="2">إجمالي الكمية</td><td>{totalProductQty}</td><td></td></tr>
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
                  <tr key={name}><td>{idx + 1}</td><td>{name}</td><td>{row.quantity}</td><td className="number-cell">{format(row.total)}</td></tr>
                ))}
                {!giftList.length && <tr><td colSpan="4">لا توجد هدايا ضمن الفترة المحددة</td></tr>}
                {giftList.length > 0 && <>
                  <tr className="summary-row"><td colSpan="2">إجمالي الهدايا</td><td>{giftQty}</td><td className="number-cell">{format(giftAmt)}</td></tr>
                  <tr className="summary-row"><td colSpan="2">إجمالي الكمية</td><td>{giftQty}</td><td></td></tr>
                </>}
              </tbody>
            </table>
          </>
        })()}
      </>
    } else if (reportType === 'morning' || reportType === 'evening') {
      const isMorning = reportType === 'morning'
      title = isMorning ? 'تقرير المبيعات - وردية صباحية' : 'تقرير المبيعات - وردية مسائية'
      const targetShift = isMorning ? 'كاشير صباحي' : 'كاشير مسائي'
      
      const sList = filteredSales.filter(s => s.shift === targetShift)
      const stats = aggregateSales(sList)
      
      const eList = filteredExpenses.filter(e => e.shift === targetShift)
      const expensesTotal = eList.reduce((sum, e) => sum + Number(e.amount), 0)
      
      content = <><table className="print-table"><thead><tr><th>البيان</th><th>المبلغ (IQD)</th></tr></thead><tbody><tr><td>إجمالي المبيعات</td><td>{format(stats.gross)}</td></tr><tr><td>الخصومات</td><td>{format(stats.discounts)}</td></tr><tr><td>المرتجعات</td><td>{format(stats.refunds)}</td></tr><tr><td>صافي المبيعات</td><td>{format(stats.net)}</td></tr><tr><td>المصاريف</td><td>{format(expensesTotal)}</td></tr><tr><td>عدد الطلبات</td><td>{stats.count}</td></tr><tr><td>المتوسط لكل طلب</td><td>{format(stats.avg)}</td></tr></tbody></table>{thermalSalesDetails(sList)}</>
    } else if (reportType === 'materials') {
      title = 'تقرير المواد المباعة'
      const materials = {}
      filteredSales.forEach(s => {
        const sItems = s.items || s.order?.items || []
        sItems.forEach(i => {
          if (!materials[i.name]) materials[i.name] = { qty: 0, total: 0 }
          materials[i.name].qty += Number(i.quantity || 0)
          materials[i.name].total += Number(i.quantity || 0) * Number(i.price || 0)
        })
      })
      const list = Object.entries(materials).sort((a, b) => b[1].qty - a[1].qty)
      const totalQty = list.reduce((sum, item) => sum + item[1].qty, 0)
      const totalAmt = list.reduce((sum, item) => sum + item[1].total, 0)
      
      content = (
        <table className="print-table">
          <thead><tr><th>ت</th><th>اسم المادة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {list.map(([name, data], idx) => (
              <tr key={name}>
                <td>{idx + 1}</td>
                <td>{name}</td>
                <td>{data.qty}</td>
                <td>{format(data.total)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="4">لا توجد مبيعات</td></tr>}
            <tr className="summary-row">
              <td colSpan="2">إجمالي المبيعات</td>
              <td>{totalQty}</td>
              <td>{format(totalAmt)}</td>
            </tr>
            <tr className="summary-row">
              <td colSpan="2">إجمالي الكمية</td>
              <td>{totalQty}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )
    } else if (reportType === 'expenses') {
      title = 'تقرير المصاريف'
      content = (
        <table className="print-table">
          <thead><tr><th>#</th><th>نوع المصروف</th><th>المبلغ</th></tr></thead>
          <tbody>
            {filteredExpenses.map((e, idx) => (
              <tr key={e.id}>
                <td>{idx + 1}</td>
                <td>{e.category} - {e.notes}</td>
                <td>{format(e.amount)}</td>
              </tr>
            ))}
            {filteredExpenses.length === 0 && <tr><td colSpan="3">لا توجد مصاريف مسجلة</td></tr>}
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan="2">إجمالي المصاريف</td>
              <td>{format(filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0))}</td>
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
                <td>{idx + 1}</td>
                <td>{name}</td>
                <td>{data.count}</td>
                <td>{format(data.total)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="4">لا توجد مبيعات</td></tr>}
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan="2">الإجمالي</td>
              <td>{list.reduce((sum, item) => sum + item[1].count, 0)}</td>
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
            <button className="primary-action" type="button" onClick={() => printReport('a4')}><Icon name="printer" size={20} /> طباعة A4</button>
            <button className="outline-btn" type="button" onClick={() => printReport('thermal')}><Icon name="printer" size={20} /> طباعة حرارية 80mm</button>
            <button className="outline-btn" type="button" disabled={!directThermalReady} onClick={printReportDirect} title={directThermalReady ? 'إرسال ESC/POS إلى الخدمة المحلية' : 'فعّل الخدمة المحلية وتحقق من الطابعة أولاً'}><Icon name="printer" size={20} /> طباعة حرارية مباشرة</button>
          </div>
        </div>
        
        <div className={`report-paper${reportType === 'comprehensive' ? ' comprehensive-report' : reportType === 'materials' ? ' materials-report' : ''}`}>
          <div className="report-paper-header">
            <img src={logoUrl} alt="101 COFFEE HOUSE" className="report-logo" />
            <h2>{title}</h2>
            <p>من: {dateFrom} إلى: {dateTo}</p>
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
