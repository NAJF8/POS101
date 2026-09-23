import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import OrderPanel from './components/OrderPanel'
import { ProductOptions, OrderType, TableSelection, Payment, QuickCash, DiscountDialog, OpenOrders, History, ReturnDialog, Receipt, ShiftLogin, SellerSelection, CashierMenu, ConfirmDialog, PrintMenu } from './components/Dialogs'
import OrderHistoryMenu from './components/OrderHistoryMenu'
import Dashboard from './components/Dashboard'
import Reports from './components/Reports'
import { Expenses } from './components/Expenses'
import { categories, products } from './data/menu'
import { Icon } from './components/Icons'
import { isAccConfigured, loginToAcc, logoutFromAcc, loadAccProducts, saveAccSale, openAccShift, closeAccShift, subscribeAuth } from './services/accSync'
import { checkThermalService, defaultThermalSettings, printThermalDocument } from './services/thermalPrinter'
import { toArabic } from './utils.js'

const blankOrder = index => ({ id: index, name: `طلب ${index}`, items: [], table: null, orderType: null, held: false, completed: false, adjustments: [] })
export const tablesEnabled = false
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const SYNC_QUEUE_KEY = 'pos101.syncQueue'
const transientSyncError = error => navigator.onLine === false || ['NETWORK_ERROR', 'NETWORK_REQUEST_FAILED', 'unavailable', 'failed-precondition'].includes(error?.code) || /fetch|network|offline|انقطاع|اتصال/i.test(String(error?.message || ''))
const withSyncTimeout = (promise, ms = 8000) => Promise.race([
  promise,
  new Promise((_, reject) => window.setTimeout(() => reject(Object.assign(new Error('انتهت مهلة الاتصال بـ ACC-101.'), { code: 'NETWORK_REQUEST_FAILED' })), ms))
])
const orderSubtotal = order => order.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
const discountValue = (subtotal, discount) => {
  if (!discount) return 0
  const raw = Number(discount.input)
  const input = Number.isFinite(raw) && raw > 0 ? raw : 0
  const percentage = discount.kind === 'baly' ? 26
    : discount.kind === 'toters' ? 25
      : discount.kind === 'percent' ? Math.min(100, input) : null
  const value = percentage === null ? input : Math.round(subtotal * percentage / 100)
  return Math.min(subtotal, Math.max(0, value))
}
const recalculateDiscount = order => {
  if (!order.discount) return order
  return { ...order, discount: { ...order.discount, value: discountValue(orderSubtotal(order), order.discount) } }
}
const shifts = [
  { shiftId: 'morning', name: 'كاشير صباحي' },
  { shiftId: 'evening', name: 'كاشير مسائي' }
]

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard')
  const [orders, setOrders] = useState(() => read('pos101.orders', [1, 2, 3, 4].map(blankOrder)))
  const [nextNumber, setNextNumber] = useState(() => read('pos101.nextNumber', 1015))
  const [active, setActive] = useState(0)
  const [category, setCategory] = useState('الكل')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [printSale, setPrintSale] = useState(null)
  const [printMessage, setPrintMessage] = useState(null)
  const [session, setSession] = useState(() => read('pos101.session', null))
  const [autoPrint, setAutoPrint] = useState(() => read('pos101.autoPrint', true))
  const [printerSettings, setPrinterSettings] = useState(() => ({ ...defaultThermalSettings, ...read('pos101.printerSettings', {}) }))
  const [thermalStatus, setThermalStatus] = useState(null)
  const [cartScrollRequest, setCartScrollRequest] = useState(0)
  const [accProducts, setAccProducts] = useState([])
  const [syncNotice, setSyncNotice] = useState(null)
  const saleInFlight = useRef(false)
  const queueFlushInFlight = useRef(false)

  useEffect(() => {
    if (!session?.profile || !isAccConfigured()) return undefined
    let active = true
    loadAccProducts().then(rows => { if (active) setAccProducts(rows) }).catch(() => {})
    return () => { active = false }
  }, [session?.profile])

  const flushSaleQueue = useCallback(async () => {
    if (!session?.profile || !isAccConfigured() || queueFlushInFlight.current) return
    const queued = read(SYNC_QUEUE_KEY, [])
    if (!queued.length) return
    queueFlushInFlight.current = true
    const remaining = []
    try {
      for (const entry of queued) {
        try {
          await withSyncTimeout(saveAccSale(entry.sale, session.profile))
          const sales = read('pos101.sales', [])
          localStorage.setItem('pos101.sales', JSON.stringify(sales.map(row => row.saleId === entry.sale.saleId ? { ...row, status: 'synced', syncConfirmedAt: Date.now() } : row)))
        } catch { remaining.push(entry) }
      }
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(remaining))
      setSyncNotice(remaining.length ? { status: 'pending', count: remaining.length } : { status: 'synced', count: queued.length })
    } finally {
      queueFlushInFlight.current = false
    }
  }, [session?.profile])

  useEffect(() => {
    if (!session?.profile) return undefined
    // Auth restoration after a page refresh is asynchronous. Retry the queue
    // when Firebase confirms the user, rather than leaving a valid pending sale
    // stranded after the first pre-auth attempt.
    const unsubscribe = subscribeAuth(user => { if (user) void flushSaleQueue() })
    void flushSaleQueue()
    window.addEventListener('online', flushSaleQueue)
    return () => { unsubscribe(); window.removeEventListener('online', flushSaleQueue) }
  }, [session?.profile, flushSaleQueue])

  const activeOrder = orders[active] || orders[0]
  const subtotal = orderSubtotal(activeOrder)
  const activeDiscount = discountValue(subtotal, activeOrder.discount)
  const total = Math.max(0, subtotal - activeDiscount)

  const openOrdersCount = orders.filter(o => o.held && !o.completed).length

  const catalogProducts = accProducts.length ? accProducts : products
  const catalogCategories = useMemo(() => ['الكل', ...Array.from(new Set(catalogProducts.map(p => p.category).filter(Boolean)))], [catalogProducts])
  const visibleProducts = useMemo(
    () => catalogProducts.filter(p =>
      (category === 'الكل' || p.category === category) &&
      `${p.name} ${p.english}`.toLowerCase().includes(query.toLowerCase())
    ),
    [catalogProducts, category, query]
  )

  useEffect(() => {
    if (!catalogCategories.includes(category)) setCategory('الكل')
  }, [catalogCategories, category])

  // Persist state
  useEffect(() => localStorage.setItem('pos101.orders', JSON.stringify(orders)), [orders])
  useEffect(() => localStorage.setItem('pos101.nextNumber', nextNumber), [nextNumber])
  useEffect(() => localStorage.setItem('pos101.session', JSON.stringify(session)), [session])
  useEffect(() => localStorage.setItem('pos101.autoPrint', JSON.stringify(autoPrint)), [autoPrint])
  useEffect(() => localStorage.setItem('pos101.printerSettings', JSON.stringify(printerSettings)), [printerSettings])

  const refreshThermalStatus = useCallback(async settings => {
    try {
      const status = await checkThermalService(settings)
      setThermalStatus(status)
      return status
    } catch (error) {
      setThermalStatus({ ok: false, error: error.message })
      return null
    }
  }, [])

  useEffect(() => { void refreshThermalStatus(printerSettings) }, [printerSettings.serviceUrl, printerSettings.token, refreshThermalStatus])

  const [pendingPayment, setPendingPayment] = useState(null)
  
  // Order mutations
  const update = useCallback(fn => setOrders(v => v.map((o, i) => i === active ? recalculateDiscount(fn(o)) : o)), [active])
  const addProduct = useCallback(p => {
    update(o => ({ ...o, items: [...o.items, { ...p, price: p.unitPrice || p.price, lineId: `${p.id}-${Date.now()}` }] }))
    setCartScrollRequest(v => v + 1)
    setModal(null)
  }, [update])
  const selectProduct = useCallback(p => p.configurable ? (setSelected(p), setModal('options')) : addProduct({ ...p, quantity: 1 }), [addProduct])
  const updateQuantity = useCallback((lineId, delta) => update(o => ({ ...o, items: o.items.flatMap(i => i.lineId === lineId ? (i.quantity + delta <= 0 ? [] : [{ ...i, quantity: i.quantity + delta }]) : [i]) })), [update])
  const removeItem = useCallback(lineId => update(o => ({ ...o, items: o.items.filter(i => i.lineId !== lineId) })), [update])
  const chooseType = useCallback(t => { update(o => ({ ...o, orderType: t })); setModal(t === 'داخل الكوفي' && tablesEnabled ? 'tables' : 'payment') }, [update])
  const chooseTable = useCallback(t => { update(o => ({ ...o, table: t })); setModal('payment') }, [update])
  const hold = useCallback(() => { if (!activeOrder.items.length) return; update(o => ({ ...o, held: true })); setModal('openOrders') }, [activeOrder.items.length, update])
  const openOrder = useCallback(id => { const idx = orders.findIndex(o => o.id === id); if (idx >= 0) { setActive(idx); setOrders(v => v.map(o => o.id === id ? ({ ...o, held: false }) : o)); setModal(null) } }, [orders])

  const directThermalReady = Boolean(printerSettings.directThermal && thermalStatus?.ready)
  const requestSalePrint = useCallback(async (sale, { reprint = false } = {}) => {
    setPrintMessage(null)
    if (!directThermalReady) {
      setPrintSale(sale)
      return true
    }
    const saleId = sale.saleId || sale.id || sale.orderNumber
    try {
      const result = await printThermalDocument({
        settings: printerSettings,
        jobId: `invoice:${saleId}${reprint ? `:reprint:${Date.now()}` : ''}`,
        document: { kind: 'invoice', sale },
      })
      setPrintMessage({ sale, text: result.duplicate ? 'تم تجاهل إعادة الإرسال المكرر.' : 'تم إرسال الفاتورة للطابعة الحرارية مباشرة.' })
      return true
    } catch (error) {
      setPrintMessage({ sale, text: `تعذر إرسال الفاتورة للطابعة الحرارية: ${error.message}` })
      return false
    }
  }, [directThermalReady, printerSettings])

  const initiateComplete = useCallback(payment => {
    if (!session || !activeOrder.items.length || saleInFlight.current) return false
    setPendingPayment(payment)
    setModal('seller-selection')
    return true
  }, [session, activeOrder.items.length])

  const finalizeSale = useCallback(async (sellerName) => {
    if (!session || !activeOrder.items.length || saleInFlight.current || !pendingPayment) return false
    if (!isAccConfigured()) { window.alert('هذا البناء غير مربوط بـ ACC-101. أعد بناء POS بإعدادات Firebase.'); return false }
    saleInFlight.current = true
    const payment = pendingPayment
    const originalItems = activeOrder.items.map(i => ({ ...i }))
    // The order owns the id before any network request.  A lost response must
    // retry this exact sale, including after a page refresh.
    const stableSaleId = activeOrder.saleId || crypto.randomUUID()
    if (!activeOrder.saleId) setOrders(v => v.map((o, i) => i === active ? { ...o, saleId: stableSaleId } : o))
    const sale = {
      saleId: stableSaleId,
      id: stableSaleId,
      orderNumber: nextNumber,
      cashierId: session.shiftId,
      cashierNameSnapshot: sellerName,
      shift: session.name,
      seller: sellerName,
      createdAt: Date.now(),
      subtotal,
      discount: activeDiscount,
      discountDetails: activeOrder.discount ? { ...activeOrder.discount, value: activeDiscount } : null,
      total,
      paymentMethod: payment.method,
      payment,
      items: originalItems,
      order: { ...activeOrder, items: originalItems }
    }
    let mappedItems = null
    try {
      mappedItems = originalItems.map(item => {
        // Keep a previously loaded ACC identity usable after a page reload
        // while the live catalog is temporarily unavailable. The server still
        // remains the authority when the queued operation is flushed.
        const remote = accProducts.find(p => String(p.id) === String(item.accProductId || item.product_id || item.id)) || (item.accProductId ? item : null)
        if (!remote) throw new Error(`الصنف غير مربوط في ACC-101: ${item.name}`)
        return { ...item, accProductId: remote.id, product_id: remote.id, name: remote.name, english: remote.english, price: Number(item.price) }
      })
      const pendingSale = { ...sale, items: mappedItems, status: 'pending_sync' }
      const queuedBeforeSend = read(SYNC_QUEUE_KEY, [])
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([...queuedBeforeSend.filter(entry => entry.sale?.saleId !== sale.saleId), { sale: pendingSale, queuedAt: Date.now() }]))
      localStorage.setItem('pos101.sales', JSON.stringify([...read('pos101.sales', []).filter(row => row.saleId !== sale.saleId), pendingSale]))
      const syncedSale = { ...sale, items: mappedItems, status: 'synced', syncConfirmedAt: Date.now() }
      await withSyncTimeout(saveAccSale(syncedSale, session.profile))
      const localSales = read('pos101.sales', [])
      localStorage.setItem('pos101.sales', JSON.stringify([...localSales.filter(row => row.saleId !== sale.saleId), syncedSale]))
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(read(SYNC_QUEUE_KEY, []).filter(entry => entry.sale?.saleId !== sale.saleId)))
      setNextNumber(n => n + 1)
      setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
      if (autoPrint || payment.forcePrint) void requestSalePrint(sale)
      setPendingPayment(null)
      window.setTimeout(() => setModal(null), 350)
      return true
    } catch (error) {
      if (transientSyncError(error)) {
        const queued = read(SYNC_QUEUE_KEY, [])
        const queuedSale = { ...sale, items: mappedItems, status: 'pending_sync' }
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([...queued.filter(entry => entry.sale?.saleId !== sale.saleId), { sale: queuedSale, queuedAt: Date.now() }]))
        localStorage.setItem('pos101.sales', JSON.stringify([...read('pos101.sales', []).filter(row => row.saleId !== sale.saleId), queuedSale]))
        setNextNumber(n => n + 1)
        setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
        setPendingPayment(null)
        setSyncNotice({ status: 'pending', count: 1, saleId: sale.saleId })
        setModal(null)
        return true
      }
      localStorage.setItem('pos101.sales', JSON.stringify([...read('pos101.sales', []).filter(row => row.saleId !== sale.saleId), { ...sale, items: mappedItems || sale.items, status: 'failed', syncError: String(error?.message || error) }]))
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(read(SYNC_QUEUE_KEY, []).filter(entry => entry.sale?.saleId !== sale.saleId)))
      window.alert(error?.message || 'تعذر حفظ البيع في ACC-101. لم يتم تفريغ السلة.')
      return false
    } finally {
      window.setTimeout(() => { saleInFlight.current = false }, 350)
    }
  }, [session, activeOrder, nextNumber, subtotal, total, activeDiscount, active, autoPrint, pendingPayment, accProducts, requestSalePrint])

  // Keyboard shortcuts and custom events
  useEffect(() => {
    const key = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'Escape') { setModal(null); return }
      if (!session) return
      
      // F6: Direct Sell + Print
      if (e.key === 'F6') {
        e.preventDefault()
        if (activeOrder.items.length && modal !== 'seller-selection') {
          initiateComplete({ method: 'cash', received: total, change: 0, forcePrint: true })
        }
      }
      
      if (e.key === 'F7') { e.preventDefault(); activeOrder.items.length ? setModal('quickCash') : window.alert('أضف منتجًا أولًا قبل الدفع السريع') }
      if (e.key === 'F8') { e.preventDefault(); /* Unassigned */ }
      if (e.key === 'F9') { e.preventDefault(); hold() }
      if (e.key === 'F10') { e.preventDefault(); setModal('openOrders') }
    }
    const openHistory = () => {
      if (!session) { setModal('login'); return }
      setModal('history')
    }
    const printHistorical = e => { void requestSalePrint(e.detail, { reprint: true }) }
    const viewHistorical = e => {
      setSelected(e.detail)
      setModal('history')
    }
    window.addEventListener('keydown', key)
    window.addEventListener('open-history', openHistory)
    window.addEventListener('print-historical-sale', printHistorical)
    window.addEventListener('view-historical-sale', viewHistorical)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('open-history', openHistory)
      window.removeEventListener('print-historical-sale', printHistorical)
      window.removeEventListener('view-historical-sale', viewHistorical)
    }
  }, [activeOrder.items.length, session, initiateComplete, total, requestSalePrint])

  // Auto-print trigger
  useEffect(() => {
    if (!printSale) return undefined
    let cancelled = false
    const waitForReceiptAssets = async () => {
      const fontReady = document.fonts?.ready || Promise.resolve()
      const logo = document.querySelector('.receipt-logo')
      const imageReady = !logo
        ? Promise.resolve()
        : logo.complete
          ? (logo.naturalWidth > 0 && logo.decode ? logo.decode().catch(() => {}) : Promise.resolve())
          : new Promise(resolve => {
              logo.addEventListener('load', () => resolve(logo.decode ? logo.decode().catch(() => {}) : undefined), { once: true })
              logo.addEventListener('error', resolve, { once: true })
            })
      await Promise.all([fontReady, imageReady])
      if (!cancelled) {
        window.print()
        setPrintMessage({ sale: printSale, text: 'تم فتح الطباعة. إذا لم تخرج الفاتورة من الطابعة، استخدم إعادة الطباعة.' })
        setPrintSale(null)
      }
    }
    waitForReceiptAssets()
    return () => { cancelled = true }
  }, [printSale])

  const newOrder = useCallback(() => {
    const i = orders.findIndex(o => !o.items.length && !o.completed)
    if (i >= 0) { setActive(i); setModal(null) }
    else { setOrders(v => [...v, blankOrder(v.length + 1)]); setActive(orders.length); setModal(null) }
  }, [orders])

  const applyDiscount = useCallback(d => { update(o => ({ ...o, discount: d })); setModal(null) }, [update])

  const recordAdjustment = useCallback(a => {
    const adjustment = { ...a, id: crypto.randomUUID(), type: 'refund', time: Date.now(), originalSaleId: selected.sale?.id }
    setOrders(v => v.map(o => o.id === selected.id ? ({ ...o, adjustments: [...(o.adjustments || []), adjustment] }) : o))
    setModal('single-history')
    setSelected(v => ({ ...v, adjustments: [...(v.adjustments || []), adjustment] }))
  }, [selected])

  const addToCompleted = useCallback(p => {
    const adjustment = { id: crypto.randomUUID(), type: 'add', product: p.name, quantity: p.quantity, amount: p.price, time: Date.now(), originalSaleId: selected.sale?.id }
    setOrders(v => v.map(o => o.id === selected.id ? ({ ...o, adjustments: [...(o.adjustments || []), adjustment] }) : o))
    setSelected(v => ({ ...v, adjustments: [...(v.adjustments || []), adjustment] }))
    setModal('single-history')
  }, [selected])

  const history = useCallback(o => { setSelected(o); setModal('single-history') }, [])
  const print = useCallback(() => {
    const sale = selected?.sale || selected
    if (!sale) return
    void requestSalePrint(sale, { reprint: true })
  }, [selected, requestSalePrint])
  const savePrinterSettings = useCallback(settings => setPrinterSettings(v => ({ ...v, ...settings })), [])
  const printReportDirect = useCallback(report => {
    if (!directThermalReady) return false
    const jobId = `report:${report.reportType}:${report.dateFrom}:${report.dateTo}`
    void printThermalDocument({ settings: printerSettings, jobId, document: { kind: 'report', report } })
      .then(result => setPrintMessage({ text: result.duplicate ? 'تم تجاهل إعادة إرسال التقرير المكرر.' : 'تم إرسال التقرير للطابعة الحرارية مباشرة.' }))
      .catch(error => setPrintMessage({ text: `تعذر إرسال التقرير للطابعة الحرارية: ${error.message}` }))
    return true
  }, [directThermalReady, printerSettings])
  const login = useCallback(async cashier => {
    const profile = await loginToAcc(cashier.email, cashier.password)
    const remoteShift = await openAccShift(profile, 0, `POS101 ${cashier.name}`)
    const remoteProducts = await loadAccProducts()
    setAccProducts(remoteProducts)
    // Keep the selected shift on the session so completed sales can be grouped
    // correctly by the morning/evening reports.
    setSession({
      cashierId: cashier.cashierId || cashier.shiftId,
      cashierNameSnapshot: cashier.name,
      shiftId: cashier.shiftId,
      shiftName: cashier.name,
      name: cashier.name,
      openedAt: Date.now(),
      status: 'open'
      , profile
      , accShiftId: remoteShift.id
    })
    setModal(null)
  }, [])
  const logout = useCallback(async () => {
    if (session?.accShiftId) {
      const counted = window.prompt('أدخل النقد الفعلي لإغلاق الوردية (د.ع):', '')
      if (counted === null) return
      try { await closeAccShift(session.accShiftId, Number(counted)) } catch (error) { window.alert(error?.message || 'تعذر إغلاق الوردية في ACC-101'); return }
    }
    if (session) {
      const shifts = read('pos101.shifts', [])
      localStorage.setItem('pos101.shifts', JSON.stringify([...shifts, { ...session, closedAt: Date.now(), status: 'closed' }]))
    }
    await logoutFromAcc().catch(() => {})
    setSession(null); setModal(null)
  }, [session])
  const clearCart = useCallback(() => update(o => ({ ...o, items: [], discount: null, table: null, orderType: null, held: false })), [update])

  return (
    <main className="app-shell">
      {syncNotice && (
        <div className={`sync-notice ${syncNotice.status}`} role="status">
          {syncNotice.status === 'pending'
            ? `بيع محفوظ محلياً — بانتظار المزامنة (${toArabic(syncNotice.count)})`
            : `تم تأكيد مزامنة ${toArabic(syncNotice.count)} بيع مع ACC-101`}
          <button type="button" onClick={() => setSyncNotice(null)} aria-label="إغلاق حالة المزامنة">×</button>
        </div>
      )}
      {session && (
        <Header 
          session={session} 
          onOpenOrders={() => setModal('openOrders')} 
          onCashierMenu={() => setModal('cashier-menu')} 
          onLogout={logout}
          openOrdersCount={openOrdersCount}
          currentView={currentView}
          onNavigate={setCurrentView}
        />
      )}

      {currentView === 'dashboard' && session && (
        <Dashboard onNavigate={setCurrentView} onLogout={logout} />
      )}

      {currentView === 'pos' && session && (
        <div className="pos-body">
          <OrderPanel
            order={activeOrder}
            updateQuantity={updateQuantity}
            removeItem={removeItem}
            onEdit={i => (setSelected(i), setModal('options'))}
            onContinue={() => setModal('orderType')}
            onHold={hold}
            onDiscount={() => setModal('discount')}
            onClear={() => setModal('confirm-clear')}
            onPrintMenu={() => setModal('print-menu')}
            onReturn={() => setModal('openOrders')}
            disabled={!session}
            scrollRequest={cartScrollRequest}
          />
          <ProductGrid
            products={visibleProducts}
            category={category}
            setCategory={setCategory}
            categories={catalogCategories}
            query={query}
            setQuery={setQuery}
            onSelect={session ? selectProduct : () => setModal('login')}
            orders={orders}
            activeOrderIndex={active}
            setActiveOrderIndex={setActive}
            onNewOrder={newOrder}
            session={session}
          />
          {modal === 'history' && <OrderHistoryMenu session={session} onClose={() => setModal(null)} />}
        </div>
      )}

      {currentView === 'reports' && session && <Reports session={session} onNavigate={setCurrentView} onDirectThermalPrint={printReportDirect} directThermalReady={directThermalReady} />}
      {currentView === 'expenses' && session && (
        <Expenses session={session} onNavigate={setCurrentView} />
      )}
      {currentView === 'expense-entry' && session && (
        <Expenses session={session} onNavigate={setCurrentView} />
      )}
      {currentView === 'reports-captain' && session && <Reports session={session} onNavigate={setCurrentView} />}

      {/* Login gate */}
      {!session && (
        <ShiftLogin shifts={shifts} onClose={() => {}} onLogin={login} />
      )}

      {/* Modals */}
      {modal === 'cashier-menu' && <CashierMenu session={session} onClose={() => setModal(null)} onLogout={logout} />}
      {modal === 'confirm-clear' && <ConfirmDialog title="تفريغ سلة المشتريات" message="سيتم مسح العناصر الحالية ولا يمكن التراجع عن العملية." onClose={() => setModal(null)} onConfirm={() => { clearCart(); setModal(null) }} />}
      {modal === 'print-menu' && <PrintMenu enabled={autoPrint} settings={printerSettings} thermalStatus={thermalStatus} onClose={() => setModal(null)} onChange={v => setAutoPrint(v)} onSave={savePrinterSettings} onCheck={settings => refreshThermalStatus({ ...printerSettings, ...settings })} onDirectChange={v => setPrinterSettings(s => ({ ...s, directThermal: v }))} />}
      {modal === 'options' && <ProductOptions product={selected} onClose={() => setModal(null)} onAdd={addProduct} />}
      {modal === 'orderType' && <OrderType onClose={() => setModal(null)} onChoose={chooseType} />}
      {modal === 'tables' && <TableSelection orders={orders} onClose={() => setModal(null)} onChoose={chooseTable} />}
      {modal === 'payment' && <Payment total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'quickCash' && <QuickCash total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'seller-selection' && <SellerSelection onClose={() => setModal(null)} onSelect={finalizeSale} />}
      {modal === 'discount' && <DiscountDialog subtotal={subtotal} current={activeOrder.discount} onClose={() => setModal(null)} onApply={applyDiscount} />}
      {modal === 'openOrders' && <OpenOrders orders={orders} onClose={() => setModal(null)} onSelect={openOrder} onHistory={history} />}
      {modal === 'single-history' && <History order={selected} onClose={() => setModal(null)} onReturn={() => setModal('return')} onAdd={() => setModal('add-existing')} onPrint={print} onReprint={print} />}
      {modal === 'return' && <ReturnDialog order={selected} onClose={() => setModal('single-history')} onConfirm={recordAdjustment} />}
      {modal === 'add-existing' && (
        <div className="overlay">
          <div className="dialog add-existing-dialog">
            <button className="close" onClick={() => setModal('single-history')}><Icon name="x" /></button>
            <h2>إضافة منتج مباع سلفاً للسجل الحالي</h2>
            <ProductGrid products={products.filter(p => !p.unavailable)} category="الكل" setCategory={() => {}} categories={[]} query="" setQuery={() => {}} onSelect={p => addToCompleted({ ...p, quantity: 1 })} />
          </div>
        </div>
      )}

      {/* Receipt – display:none in normal mode, shown only @media print */}
      {printSale && <Receipt sale={printSale} />}
      {printMessage && <div className="print-status" role="status">
        <span>{printMessage.text}</span>
        <button type="button" onClick={() => { setPrintMessage(null); setPrintSale(printMessage.sale) }}>إعادة طباعة</button>
        <button type="button" aria-label="إغلاق رسالة الطباعة" onClick={() => setPrintMessage(null)}>×</button>
      </div>}
    </main>
  )
}
