import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import OrderPanel from './components/OrderPanel'
import { ProductOptions, OrderType, TableSelection, Payment, QuickCash, DiscountDialog, OpenOrders, History, ReturnDialog, Receipt, CashierLogin, CashierMenu, ConfirmDialog, PrintMenu } from './components/Dialogs'
import { categories, products } from './data/menu'
import { Icon } from './components/Icons'

const blankOrder = index => ({ id: index, name: `طلب ${index}`, items: [], table: null, orderType: null, held: false, completed: false, adjustments: [] })
export const tablesEnabled = false
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const mockCashiers = [
  { cashierId: 'cashier-ali', name: 'علي', pin: '1010', enabled: true },
  { cashierId: 'cashier-ahmed', name: 'أحمد', pin: '2020', enabled: true }
]

export default function App() {
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
  const subtotal = activeOrder.items.reduce((s, i) => s + i.price * i.quantity, 0)
  const total = Math.max(0, subtotal - (activeOrder.discount?.value || 0))

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

  // Order mutations
  const update = useCallback(fn => setOrders(v => v.map((o, i) => i === active ? fn(o) : o)), [active])
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

  const complete = useCallback(payment => {
    if (!session || !activeOrder.items.length || saleInFlight.current) return false
    saleInFlight.current = true
    const originalItems = activeOrder.items.map(i => ({ ...i }))
    const sale = {
      saleId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      orderNumber: nextNumber,
      cashierId: session.cashierId,
      cashierNameSnapshot: session.cashierNameSnapshot,
      shiftId: session.shiftId,
      createdAt: Date.now(),
      subtotal,
      discount: activeOrder.discount?.value || 0,
      total,
      paymentMethod: payment.method,
      payment,
      items: originalItems,
      order: { ...activeOrder, items: originalItems }
    }
    try {
      // Persist before clearing: a storage failure must leave this order intact.
      localStorage.setItem('pos101.sales', JSON.stringify([...read('pos101.sales', []), sale]))
      setNextNumber(n => n + 1)
      setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
      if (autoPrint || payment.forcePrint) setPrintSale(sale)
      // Keep the processing dialog over the page through the lock window so a
      // second rapid tap cannot fall through to a product beneath the dialog.
      window.setTimeout(() => setModal(null), 350)
      return true
    } catch {
      return false
    } finally {
      window.setTimeout(() => { saleInFlight.current = false }, 350)
    }
  }, [session, activeOrder, nextNumber, subtotal, total, active, autoPrint])

  // Keyboard shortcuts
  useEffect(() => {
    const key = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'Escape') { setModal(null); return }
      if (!session) return
      
      // F6: Direct Sell + Print
      if (e.key === 'F6') {
        e.preventDefault()
        if (activeOrder.items.length) {
          // Trigger complete with a default method (e.g., Cash) and force print
          complete({ method: 'cash', received: total, change: 0, forcePrint: true })
        }
      }
      
      if (e.key === 'F7') { e.preventDefault(); activeOrder.items.length ? setModal('quickCash') : window.alert('أضف منتجًا أولًا قبل الدفع السريع') }
      if (e.key === 'F8') { e.preventDefault(); /* Unassigned */ }
      if (e.key === 'F9') { e.preventDefault(); hold() }
      if (e.key === 'F10') { e.preventDefault(); setModal('openOrders') }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [activeOrder.items.length, session, complete, total])

  // Auto-print trigger
  useEffect(() => {
    if (printSale) {
      // Leave the rendered receipt mounted long enough for Chrome's preview to
      // capture it before returning the POS to its normal screen.
      const t = setTimeout(() => { window.print(); setPrintSale(null) }, 500)
      return () => clearTimeout(t)
    }
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
    setModal('history')
    setSelected(v => ({ ...v, adjustments: [...(v.adjustments || []), adjustment] }))
  }, [selected])

  const addToCompleted = useCallback(p => {
    const adjustment = { id: crypto.randomUUID(), type: 'add', product: p.name, quantity: p.quantity, amount: p.price, time: Date.now(), originalSaleId: selected.sale?.id }
    setOrders(v => v.map(o => o.id === selected.id ? ({ ...o, adjustments: [...(o.adjustments || []), adjustment] }) : o))
    setSelected(v => ({ ...v, adjustments: [...(v.adjustments || []), adjustment] }))
    setModal('history')
  }, [selected])

  const history = useCallback(o => { setSelected(o); setModal('history') }, [])
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
      <Header 
        session={session} 
        onOpenOrders={() => setModal('openOrders')} 
        onCashierMenu={() => setModal('cashier-menu')} 
        onLogout={logout}
        openOrdersCount={openOrdersCount}
      />

      {/* POS Body - Two Main Panels */}
      <div className="pos-body">
        
        {/* Left Panel: Cart */}
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

        {/* Right Panel: Catalog */}
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
        
      </div>

      {/* Login gate */}
      {!session && (
        <div className="login-gate">
          <b>سجّل دخول الكاشير للبدء</b>
          <button className="primary-action" style={{ width: 200 }} onClick={() => setModal('login')}>دخول الكاشير</button>
        </div>
      )}

      {/* Modals */}
      {modal === 'login' && <CashierLogin cashiers={mockCashiers} onClose={() => setModal(null)} onLogin={login} />}
      {modal === 'cashier-menu' && <CashierMenu session={session} onClose={() => setModal(null)} onLogout={logout} />}
      {modal === 'confirm-clear' && <ConfirmDialog title="إلغاء الطلب وإفراغ السلة؟" message="سيتم مسح الطلب الحالي فقط، ولن تتأثر الطلبات الأخرى." onClose={() => setModal(null)} onConfirm={() => { clearCart(); setModal(null) }} />}
      {modal === 'print-menu' && <PrintMenu enabled={autoPrint} onClose={() => setModal(null)} onChange={v => { setAutoPrint(v); setModal(null) }} />}
      {modal === 'options' && <ProductOptions product={selected} onClose={() => setModal(null)} onAdd={addProduct} />}
      {modal === 'orderType' && <OrderType onClose={() => setModal(null)} onChoose={chooseType} />}
      {modal === 'tables' && <TableSelection orders={orders} onClose={() => setModal(null)} onChoose={chooseTable} />}
      {modal === 'payment' && <Payment total={total} onClose={() => setModal(null)} onSuccess={complete} />}
      {modal === 'quickCash' && <QuickCash total={total} onClose={() => setModal(null)} onSuccess={complete} />}
      {modal === 'discount' && <DiscountDialog subtotal={subtotal} current={activeOrder.discount} onClose={() => setModal(null)} onApply={applyDiscount} />}
      {modal === 'openOrders' && <OpenOrders orders={orders} onClose={() => setModal(null)} onSelect={openOrder} onHistory={history} />}
      {modal === 'history' && <History order={selected} onClose={() => setModal(null)} onReturn={() => setModal('return')} onAdd={() => setModal('add-existing')} onPrint={print} onReprint={print} />}
      {modal === 'return' && <ReturnDialog order={selected} onClose={() => setModal('history')} onConfirm={recordAdjustment} />}
      {modal === 'add-existing' && (
        <div className="overlay">
          <div className="dialog add-existing-dialog">
            <button className="close" onClick={() => setModal('history')}><Icon name="x" /></button>
            <h2>إضافة منتج إلى الطلب المكتمل</h2>
            <ProductGrid products={products.filter(p => !p.unavailable)} category="الكل" setCategory={() => {}} categories={[]} query="" setQuery={() => {}} onSelect={p => addToCompleted({ ...p, quantity: 1 })} />
          </div>
        </div>
      )}

      {/* Receipt — display:none in normal mode, shown only @media print */}
      {printSale && <Receipt sale={printSale} />}
    </main>
  )
}
