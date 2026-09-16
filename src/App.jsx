import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import OrderPanel from './components/OrderPanel'
import { ProductOptions, OrderType, TableSelection, Payment, QuickCash, DiscountDialog, OpenOrders, History, ReturnDialog, Receipt, ShiftLogin, SellerSelection, CashierMenu, ConfirmDialog, PrintMenu } from './components/Dialogs'
import OrderHistoryMenu from './components/OrderHistoryMenu'
import Dashboard from './components/Dashboard'
import Reports from './components/Reports'
import { Expenses, ExpenseEntry } from './components/Expenses'
import { categories, products } from './data/menu'
import { Icon } from './components/Icons'

const blankOrder = index => ({ id: index, name: `طلب ${index}`, items: [], table: null, orderType: null, held: false, completed: false, adjustments: [] })
export const tablesEnabled = false
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
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
  const [session, setSession] = useState(() => read('pos101.session', null))
  const [autoPrint, setAutoPrint] = useState(() => read('pos101.autoPrint', true))
  const [cartScrollRequest, setCartScrollRequest] = useState(0)
  const saleInFlight = useRef(false)

  const activeOrder = orders[active] || orders[0]
  const subtotal = orderSubtotal(activeOrder)
  const activeDiscount = discountValue(subtotal, activeOrder.discount)
  const total = Math.max(0, subtotal - activeDiscount)

  const openOrdersCount = orders.filter(o => o.held && !o.completed).length

  const visibleProducts = useMemo(
    () => products.filter(p =>
      (category === 'الكل' || p.category === category) &&
      `${p.name} ${p.english}`.toLowerCase().includes(query.toLowerCase())
    ),
    [category, query]
  )

  // Persist state
  useEffect(() => localStorage.setItem('pos101.orders', JSON.stringify(orders)), [orders])
  useEffect(() => localStorage.setItem('pos101.nextNumber', nextNumber), [nextNumber])
  useEffect(() => localStorage.setItem('pos101.session', JSON.stringify(session)), [session])
  useEffect(() => localStorage.setItem('pos101.autoPrint', JSON.stringify(autoPrint)), [autoPrint])

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

  const initiateComplete = useCallback(payment => {
    if (!session || !activeOrder.items.length || saleInFlight.current) return false
    setPendingPayment(payment)
    setModal('seller-selection')
    return true
  }, [session, activeOrder.items.length])

  const finalizeSale = useCallback((sellerName) => {
    if (!session || !activeOrder.items.length || saleInFlight.current || !pendingPayment) return false
    saleInFlight.current = true
    const payment = pendingPayment
    const originalItems = activeOrder.items.map(i => ({ ...i }))
    const sale = {
      saleId: crypto.randomUUID(),
      id: crypto.randomUUID(),
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
    try {
      localStorage.setItem('pos101.sales', JSON.stringify([...read('pos101.sales', []), sale]))
      setNextNumber(n => n + 1)
      setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
      if (autoPrint || payment.forcePrint) setPrintSale(sale)
      setPendingPayment(null)
      window.setTimeout(() => setModal(null), 350)
      return true
    } catch {
      return false
    } finally {
      window.setTimeout(() => { saleInFlight.current = false }, 350)
    }
  }, [session, activeOrder, nextNumber, subtotal, total, activeDiscount, active, autoPrint, pendingPayment])

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
    const printHistorical = e => {
      setPrintSale(e.detail)
    }
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
  }, [activeOrder.items.length, session, initiateComplete, total])

  // Auto-print trigger
  useEffect(() => {
    if (!printSale) return undefined
    let cancelled = false
    const waitForReceiptAssets = async () => {
      const fontReady = document.fonts?.ready || Promise.resolve()
      const logo = document.querySelector('.receipt-logo')
      const imageReady = !logo || logo.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            logo.addEventListener('load', resolve, { once: true })
            logo.addEventListener('error', resolve, { once: true })
          })
      await Promise.all([fontReady, imageReady])
      if (!cancelled) {
        window.print()
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
  const print = useCallback(() => setPrintSale(selected?.sale || selected), [selected])
  const login = useCallback(cashier => {
    setSession({ cashierId: cashier.cashierId, cashierNameSnapshot: cashier.name, shiftId: crypto.randomUUID(), openedAt: Date.now(), status: 'open' })
    setModal(null)
  }, [])
  const logout = useCallback(() => {
    if (session) {
      const shifts = read('pos101.shifts', [])
      localStorage.setItem('pos101.shifts', JSON.stringify([...shifts, { ...session, closedAt: Date.now(), status: 'closed' }]))
    }
    setSession(null); setModal(null)
  }, [session])
  const clearCart = useCallback(() => update(o => ({ ...o, items: [], discount: null, table: null, orderType: null, held: false })), [update])

  return (
    <main className="app-shell">
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
            categories={categories}
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

      {currentView === 'reports' && session && <Reports onNavigate={setCurrentView} />}
      {currentView === 'expenses' && session && <Expenses onNavigate={setCurrentView} />}
      {currentView === 'expense-entry' && session && <ExpenseEntry onNavigate={setCurrentView} />}
      {currentView === 'reports-captain' && session && <Reports onNavigate={setCurrentView} />}

      {/* Login gate */}
      {!session && (
        <ShiftLogin shifts={shifts} onClose={() => {}} onLogin={login} />
      )}

      {/* Modals */}
      {modal === 'cashier-menu' && <CashierMenu session={session} onClose={() => setModal(null)} onLogout={logout} />}
      {modal === 'confirm-clear' && <ConfirmDialog title="تفريغ سلة المشتريات" message="سيتم مسح العناصر الحالية ولا يمكن التراجع عن العملية." onClose={() => setModal(null)} onConfirm={() => { clearCart(); setModal(null) }} />}
      {modal === 'print-menu' && <PrintMenu enabled={autoPrint} onClose={() => setModal(null)} onChange={v => { setAutoPrint(v); setModal(null) }} />}
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
    </main>
  )
}
