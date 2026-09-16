import React, { useState, useMemo } from 'react'
import { Icon } from './Icons'

const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const logoUrl = `${import.meta.env.BASE_URL}assets/branding/logo-transparent.png`

export default function Reports({ onNavigate }) {
  const [reportType, setReportType] = useState(null)
  
  const todayStr = new Date().toISOString().substring(0, 10)
  const [dateFrom, setDateFrom] = useState(todayStr)
  const [dateTo, setDateTo] = useState(todayStr)
  
  const sales = useMemo(() => read('pos101.sales', []), [])
  const expenses = useMemo(() => read('pos101.expenses', []), [])

  const startMs = new Date(dateFrom).setHours(0, 0, 0, 0)
  const endMs = new Date(dateTo).setHours(23, 59, 59, 999)

  const filteredSales = useMemo(() => {
    return sales.filter(s => s.createdAt >= startMs && s.createdAt <= endMs && (!s.voided))
  }, [sales, startMs, endMs])

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => e.date >= startMs && e.date <= endMs)
  }, [expenses, startMs, endMs])

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

    if (reportType === 'comprehensive') {
      title = 'تقرير شامل للمبيعات'
      const stats = aggregateSales(filteredSales)
      const expensesTotal = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
      
      content = (
        <table className="print-table">
          <thead><tr><th>البيان</th><th>المبلغ (IQD)</th></tr></thead>
          <tbody>
            <tr><td>إجمالي المبيعات</td><td>{format(stats.gross)}</td></tr>
            <tr><td>الخصومات</td><td>{format(stats.discounts)}</td></tr>
            <tr><td>المرتجعات</td><td>{format(stats.refunds)}</td></tr>
            <tr><td>صافي المبيعات</td><td>{format(stats.net)}</td></tr>
            <tr><td>المصاريف</td><td>{format(expensesTotal)}</td></tr>
            <tr style={{ fontWeight: 'bold' }}><td>صافي الأرباح (بعد المصاريف)</td><td>{format(stats.net - expensesTotal)}</td></tr>
            <tr><td>عدد الطلبات</td><td>{stats.count}</td></tr>
          </tbody>
        </table>
      )
    } else if (reportType === 'morning' || reportType === 'evening') {
      const isMorning = reportType === 'morning'
      title = isMorning ? 'تقرير المبيعات - وردية صباحية' : 'تقرير المبيعات - وردية مسائية'
      const targetShift = isMorning ? 'كاشير صباحي' : 'كاشير مسائي'
      
      const sList = filteredSales.filter(s => s.shift === targetShift)
      const stats = aggregateSales(sList)
      
      const eList = filteredExpenses.filter(e => e.shift === targetShift)
      const expensesTotal = eList.reduce((sum, e) => sum + Number(e.amount), 0)
      
      content = (
        <table className="print-table">
          <thead><tr><th>البيان</th><th>المبلغ (IQD)</th></tr></thead>
          <tbody>
            <tr><td>إجمالي المبيعات</td><td>{format(stats.gross)}</td></tr>
            <tr><td>الخصومات</td><td>{format(stats.discounts)}</td></tr>
            <tr><td>المرتجعات</td><td>{format(stats.refunds)}</td></tr>
            <tr><td>صافي المبيعات</td><td>{format(stats.net)}</td></tr>
            <tr><td>المصاريف</td><td>{format(expensesTotal)}</td></tr>
            <tr><td>عدد الطلبات</td><td>{stats.count}</td></tr>
            <tr><td>المتوسط لكل طلب</td><td>{format(stats.avg)}</td></tr>
          </tbody>
        </table>
      )
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
          <button className="primary-action" onClick={() => window.print()}><Icon name="printer" size={20} /> طباعة</button>
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
