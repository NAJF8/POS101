import React, { useState, useMemo } from 'react'
import { Icon } from './Icons'

const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const shiftDefinitions = {
  morning: { id: 'morning', name: 'كاشير صباحي' },
  evening: { id: 'evening', name: 'كاشير مسائي' }
}
// Existing sales created before shift metadata was persisted have no `shift`.
// Keep those records immutable and classify them by the local cashier day.
const LEGACY_MORNING_START = 6
const LEGACY_EVENING_START = 16
const localDateInput = date => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const shiftForSale = sale => {
  const value = String(sale.shift || sale.shiftName || sale.shiftId || '').trim().toLocaleLowerCase('ar-IQ')
  if (value === shiftDefinitions.morning.id || value === shiftDefinitions.morning.name.toLocaleLowerCase('ar-IQ')) return 'morning'
  if (value === shiftDefinitions.evening.id || value === shiftDefinitions.evening.name.toLocaleLowerCase('ar-IQ')) return 'evening'
  if (!Number.isFinite(Number(sale.createdAt))) return null
  const hour = new Date(Number(sale.createdAt)).getHours()
  return hour >= LEGACY_MORNING_START && hour < LEGACY_EVENING_START ? 'morning' : 'evening'
}
// Reports print in their own A4 document.  They must never inherit the POS
// screen's thermal-receipt print rules.
const logoUrl = new URL(`${import.meta.env.BASE_URL}assets/branding/101-print-mark.png`, window.location.href).href
const formatDate = value => new Date(value).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' })

const reportPrintStyles = (mode, isComprehensive = false) => `
  @page { size: ${mode === 'thermal' ? '80mm auto' : 'A4 portrait'}; margin: ${mode === 'thermal' ? '0' : '12mm'}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif; }
  body { direction: rtl; font-size: ${mode === 'thermal' ? '10pt' : '12pt'}; line-height: 1.5; }
  .report-paper { width: 100%; max-width: none; margin: 0; padding: ${mode === 'thermal' ? '3mm' : '0'}; background: #fff; }
  .report-paper-header { text-align: center; padding-bottom: 6mm; margin-bottom: 7mm; border-bottom: .4mm solid #40533b; }
  .report-logo { display: block; width: ${mode === 'thermal' ? '30mm' : '40mm'}; height: ${mode === 'thermal' ? '22mm' : '29mm'}; object-fit: contain; margin: 0 auto 3mm; }
  h2 { margin: 0 0 2mm; font-size: ${mode === 'thermal' ? '15pt' : '20pt'}; color: #000; }
  h3 { margin: 7mm 0 3mm; font-size: ${mode === 'thermal' ? '12pt' : '15pt'}; color: #000; }
  p { margin: 0; }
  .print-table { width: 100%; border-collapse: collapse; margin: 0 0 6mm; ${mode === 'thermal' ? 'table-layout: fixed;' : ''} }
  .print-table th, .print-table td { border: .35mm solid #000; padding: ${mode === 'thermal' ? '1.5mm 1mm' : '2.8mm'}; color: #000; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
  .print-table th { background: #fff; color: #000; font-weight: 800; }
  .print-table tfoot td { background: #fff; color: #000; font-weight: 800; }
  .number-cell { direction: ltr; text-align: left; white-space: nowrap; }
  .report-paper-footer { display: ${mode === 'thermal' ? 'block' : 'flex'}; justify-content: space-between; gap: 6mm; padding-top: 4mm; margin-top: 7mm; border-top: .35mm solid #000; color: #000; font-weight: 800; ${mode === 'thermal' ? 'text-align: center;' : ''} }
  thead { display: table-header-group; }
  tr, .report-paper-header, .report-paper-footer { break-inside: avoid; page-break-inside: avoid; }
  ${mode === 'thermal' && isComprehensive ? `
  html, body { width: 80mm; height: auto; min-height: 0; overflow: visible; }
  body { font-size: 11pt; line-height: 1.3; font-weight: 600; }
  .report-paper { width: 80mm; min-height: 0; padding: 2mm 4mm 5mm; }
  .report-paper-header { margin: 0 0 2mm; padding: 0 0 2mm; border-bottom: .35mm solid #000; break-inside: avoid; page-break-inside: avoid; }
  .report-paper-header > p { font-size: 10pt; font-weight: 700; }
  .report-logo { width: auto; height: 22mm; max-width: 100%; margin: 0 auto 2mm; filter: brightness(0); }
  h2 { margin: 0 0 2mm; font-size: 19pt; font-weight: 900; line-height: 1.2; }
  h3 { margin: 3mm 0 2mm; padding-bottom: 1mm; border-bottom: .3mm solid #000; font-size: 14pt; font-weight: 900; break-after: avoid; page-break-after: avoid; }
  .print-table { margin: 0 0 3mm; border: .35mm solid #000; }
  .print-table th, .print-table td { border: .3mm solid #000; padding: 1.5mm 1mm; font-size: 10pt; font-weight: 700; text-align: center; vertical-align: middle; }
  .print-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .report-summary { break-inside: avoid; page-break-inside: avoid; }
  .report-summary tbody tr:nth-child(4) td, .report-summary tbody tr:nth-child(6) td { border-top: .6mm solid #000; border-bottom: .6mm solid #000; font-size: 13pt; font-weight: 900; }
  .sales-details:not(.thermal-print-only) { display: none !important; }
  .thermal-print-only { display: block !important; }
  .thermal-product-table th:first-child, .thermal-product-table td:first-child { width: 48%; text-align: right; }
  .thermal-product-table td:last-child, .thermal-captain-table td:last-child { white-space: nowrap; }
  .thermal-sales-table td:first-child { text-align: right; }
  .thermal-sales-table td:last-child, .thermal-sales-table tfoot td { font-size: 10pt; font-weight: 900; }
  .report-paper-footer { display: block; margin-top: 3mm; padding-top: 2mm; border-top: .35mm solid #000; text-align: center; font-size: 9pt; break-inside: avoid; page-break-inside: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  ` : ''}
`

export default function Reports({ onNavigate }) {
  const [reportType, setReportType] = useState(null)
  
  const todayStr = localDateInput(new Date())
  const [dateFrom, setDateFrom] = useState(todayStr)
  const [dateTo, setDateTo] = useState(todayStr)
  
  const sales = useMemo(() => read('pos101.sales', []), [])
  const expenses = useMemo(() => read('pos101.expenses', []), [])

  const startMs = new Date(`${dateFrom}T00:00:00`).getTime()
  const endMs = new Date(`${dateTo}T23:59:59.999`).getTime()

  const filteredSales = useMemo(() => {
    return sales.filter(s => s.createdAt >= startMs && s.createdAt <= endMs && (!s.voided))
  }, [sales, startMs, endMs])

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => e.date >= startMs && e.date <= endMs)
  }, [expenses, startMs, endMs])

  const printReport = mode => {
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
    const printPaper = paper.cloneNode(true)
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>معاينة التقرير</title><style>${reportPrintStyles(mode, reportType === 'comprehensive')}</style></head><body>${printPaper.outerHTML}</body></html>`)
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

    const salesDetails = sList => (
      <section className="sales-details">
        <h3>تفاصيل عمليات البيع</h3>
        <table className="print-table">
          <thead><tr><th>#</th><th>رقم الطلب</th><th>التاريخ والوقت</th><th>الكابتن</th><th>الدفع</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {sList.map((sale, index) => (
              <tr key={sale.id || `${sale.orderNumber}-${sale.createdAt}`}>
                <td>{index + 1}</td>
                <td className="number-cell">{sale.orderNumber || '—'}</td>
                <td>{sale.createdAt ? formatDate(sale.createdAt) : '—'}</td>
                <td>{sale.seller || sale.cashierNameSnapshot || 'غير محدد'}</td>
                <td>{sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</td>
                <td className="number-cell">{format(sale.total)}</td>
              </tr>
            ))}
            {!sList.length && <tr><td colSpan="6">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
            <tr className="sales-total-row"><td colSpan="5">إجمالي عمليات البيع</td><td className="number-cell">{format(sList.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</td></tr>
          </tbody>
        </table>
      </section>
    )

    const thermalPrintDetails = sList => {
      const products = new Map()
      const captains = new Map()
      sList.forEach(sale => {
        const seller = sale.seller || sale.cashierNameSnapshot || 'غير محدد'
        const captain = captains.get(seller) || { count: 0, total: 0 }
        captain.count += 1
        captain.total += Number(sale.total || 0)
        captains.set(seller, captain)
        ;(sale.order?.items || sale.items || []).forEach(item => {
          const row = products.get(item.name) || { quantity: 0, total: 0 }
          row.quantity += Number(item.quantity || 0)
          row.total += Number(item.quantity || 0) * Number(item.price || 0)
          products.set(item.name, row)
        })
      })
      return <section className="sales-details thermal-print-only" style={{ display: 'none' }}>
        <h3>تفاصيل المبيعات حسب المادة</h3>
        <table className="print-table thermal-product-table">
          <thead><tr><th>اسم المادة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {[...products.entries()].sort((a, b) => b[1].quantity - a[1].quantity).map(([name, row]) => <tr key={name}><td>{name}</td><td>{row.quantity}</td><td>{format(row.total)}</td></tr>)}
            {!products.size && <tr><td colSpan="3">لا توجد تفاصيل مواد ضمن الفترة المحددة</td></tr>}
          </tbody>
        </table>
        <h3>تفاصيل المبيعات حسب الكاشير</h3>
        <table className="print-table thermal-captain-table">
          <thead><tr><th>الاسم</th><th>الطلبات</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {[...captains.entries()].map(([name, row]) => <tr key={name}><td>{name}</td><td>{row.count}</td><td>{format(row.total)}</td></tr>)}
            {!captains.size && <tr><td colSpan="3">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
          </tbody>
        </table>
        <h3>تفاصيل عمليات البيع</h3>
        <table className="print-table thermal-sales-table">
          <tbody>
            {sList.map((sale, index) => <tr key={sale.id || `${sale.orderNumber}-${sale.createdAt}`}>
              <td><b>رقم الطلب:</b> {sale.orderNumber || '—'}<br /><b>التاريخ والوقت:</b> {sale.createdAt ? formatDate(sale.createdAt) : '—'}<br /><b>الكاشير:</b> {sale.seller || sale.cashierNameSnapshot || 'غير محدد'}<br /><b>الدفع:</b> {sale.paymentMethod === 'electronic' ? 'إلكتروني' : 'نقدي'}</td>
              <td><b>الإجمالي</b><br />{format(sale.total)}</td>
            </tr>)}
            {!sList.length && <tr><td colSpan="2">لا توجد مبيعات ضمن الفترة المحددة</td></tr>}
          </tbody>
          <tfoot><tr><td>إجمالي عمليات البيع</td><td>{format(sList.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</td></tr></tfoot>
        </table>
      </section>
    }

    if (reportType === 'comprehensive') {
      title = 'تقرير شامل'
      const stats = aggregateSales(filteredSales)
      const expensesTotal = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
      
      content = <><table className="print-table report-summary"><thead><tr><th>البيان</th><th>المبلغ (IQD)</th></tr></thead><tbody><tr><td>إجمالي المبيعات</td><td>{format(stats.gross)}</td></tr><tr><td>الخصومات</td><td>{format(stats.discounts)}</td></tr><tr><td>المرتجعات</td><td>{format(stats.refunds)}</td></tr><tr><td>صافي المبيعات</td><td>{format(stats.net)}</td></tr><tr><td>المصاريف</td><td>{format(expensesTotal)}</td></tr><tr style={{ fontWeight: 'bold' }}><td>صافي الأرباح (بعد المصاريف)</td><td>{format(stats.net - expensesTotal)}</td></tr><tr><td>عدد الطلبات</td><td>{stats.count}</td></tr></tbody></table>{salesDetails(filteredSales)}{thermalPrintDetails(filteredSales)}</>
    } else if (reportType === 'morning' || reportType === 'evening') {
      const isMorning = reportType === 'morning'
      title = isMorning ? 'تقرير المبيعات - وردية صباحية' : 'تقرير المبيعات - وردية مسائية'
      const targetShift = isMorning ? 'morning' : 'evening'
      
      const sList = filteredSales.filter(s => shiftForSale(s) === targetShift)
      const stats = aggregateSales(sList)
      
      const targetShiftName = shiftDefinitions[targetShift].name
      const eList = filteredExpenses.filter(e => e.shift === targetShiftName || e.shift === targetShift)
      const expensesTotal = eList.reduce((sum, e) => sum + Number(e.amount), 0)
      
      content = <><table className="print-table"><thead><tr><th>البيان</th><th>المبلغ (IQD)</th></tr></thead><tbody><tr><td>إجمالي المبيعات</td><td>{format(stats.gross)}</td></tr><tr><td>الخصومات</td><td>{format(stats.discounts)}</td></tr><tr><td>المرتجعات</td><td>{format(stats.refunds)}</td></tr><tr><td>صافي المبيعات</td><td>{format(stats.net)}</td></tr><tr><td>المصاريف</td><td>{format(expensesTotal)}</td></tr><tr><td>عدد الطلبات</td><td>{stats.count}</td></tr><tr><td>المتوسط لكل طلب</td><td>{format(stats.avg)}</td></tr></tbody></table>{salesDetails(sList)}</>
    } else if (reportType === 'materials') {
      title = 'تقرير المواد المباعة'
      const materials = {}
      filteredSales.forEach(s => {
        s.items.forEach(i => {
          if (!materials[i.name]) materials[i.name] = { qty: 0, total: 0 }
          materials[i.name].qty += i.quantity
          materials[i.name].total += i.quantity * i.price
        })
      })
      const list = Object.entries(materials).sort((a, b) => b[1].qty - a[1].qty)
      
      content = (
        <table className="print-table">
          <thead><tr><th>#</th><th>اسم المادة</th><th>الكمية</th><th>إجمالي المبيعات</th></tr></thead>
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
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan="2">إجمالي المبيعات</td>
              <td>{list.reduce((sum, item) => sum + item[1].qty, 0)}</td>
              <td>{format(list.reduce((sum, item) => sum + item[1].total, 0))}</td>
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
          <div className="report-print-actions">
            <button className="primary-action" type="button" onClick={() => printReport('a4')}><Icon name="printer" size={20} /> طباعة A4</button>
            <button className="outline-btn" type="button" onClick={() => printReport('thermal')}><Icon name="printer" size={20} /> طباعة حرارية 80mm</button>
          </div>
        </div>
        
        <div className="report-paper">
          <div className="report-paper-header">
            <img src={logoUrl} alt="101 COFFEE HOUSE" className="report-logo" />
            <h2>{title}</h2>
            <p>من: {dateFrom} إلى: {dateTo}</p>
          </div>
          
          {content}
          
          <div className="report-paper-footer">
            <p>{new Date().toLocaleString('ar-IQ')}</p>
            <p>شكراً لكم</p>
          </div>
        </div>
      </div>
    )
  }

  return reportType ? renderPrintableReport() : renderReportCards()
}
