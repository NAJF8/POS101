import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import OrderPanel from './components/OrderPanel'
import { ProductOptions, VariantModal, OrderType, TableSelection, Payment, QuickCash, DiscountDialog, OpenOrders, History, ReturnDialog, Receipt, ShiftLogin, SellerSelection, CashierMenu, ConfirmDialog, PrintMenu } from './components/Dialogs'
import OrderHistoryMenu from './components/OrderHistoryMenu'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'
import Reports from './components/Reports'
import { Expenses } from './components/Expenses'
import { Purchases } from './components/Purchases'
import { categories, products, categoryId } from './data/menu'
import { Icon } from './components/Icons'
import { checkThermalService, defaultThermalSettings, printThermalDocument } from './services/thermalPrinter'
import { enqueueSale, buildSalesBackup } from './services/salesSyncQueue'
import { centralAuth, getCentralSyncState, isCentralAdminUser, isCentralCashierUser, isCentralProductManager, runAdminCentralRefresh, runCashierCentralSync, saveCentralProduct, signInAdminWithGoogle, signInCentralWithGoogle, signOutCentral, subscribeCentralAuth, subscribeCentralProducts, subscribeCentralSales, subscribeCentralSalesReadOnly, subscribeOperationalDay, startOperationalDay, endOperationalDay, readOpenOperationalDay } from './services/posCentralSync.js'
import { createCentralSyncClickHandler } from './services/centralSyncController.js'
import { formatNumber } from './utils.js'
import { getOpenOrders } from './services/orderState.js'
import { readLocalSales } from './services/reportSales.js'
import { calculateOperationalDaySummary } from './services/operationalDayReport.js'

const blankOrder = index => ({ id: index, name: `طلب ${index}`, items: [], table: null, orderType: null, held: false, completed: false, adjustments: [] })
export const tablesEnabled = false
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const orderSubtotal = order => order.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
const defaultDiscountPresets = { baly: 26, toters: 25 }
const normalizeDiscountPreset = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback
}
const normalizeDiscountPresets = value => ({
  baly: normalizeDiscountPreset(value?.baly, defaultDiscountPresets.baly),
  toters: normalizeDiscountPreset(value?.toters, defaultDiscountPresets.toters),
})
const discountValue = (subtotal, discount) => {
  if (!discount) return 0
  const raw = Number(discount.input)
  const fallback = discount.kind === 'baly' ? defaultDiscountPresets.baly
    : discount.kind === 'toters' ? defaultDiscountPresets.toters : 0
  const input = Number.isFinite(raw) && raw >= 0 ? raw : fallback
  const percentage = discount.kind === 'baly' || discount.kind === 'toters' || discount.kind === 'percent'
    ? Math.min(100, input)
    : null
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
  const [discountPresets, setDiscountPresets] = useState(() => normalizeDiscountPresets(read('pos101.discountPresets', defaultDiscountPresets)))
  const [thermalStatus, setThermalStatus] = useState(null)
  const [cartScrollRequest, setCartScrollRequest] = useState(0)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncLabel, setSyncLabel] = useState('المزامنة جاهزة')
  const [syncAuthStatus, setSyncAuthStatus] = useState(null)
  const [adminAuthUser, setAdminAuthUser] = useState(null)
  const [adminAuthBusy, setAdminAuthBusy] = useState(false)
  const [adminAuthError, setAdminAuthError] = useState('')
  const [productAuthUser, setProductAuthUser] = useState(null)
  const [adminCentralSales, setAdminCentralSales] = useState([])
  const centralListener = useRef(null)
  const productListener = useRef(null)
  const [centralProducts, setCentralProducts] = useState([])
  const [operationalDay, setOperationalDay] = useState(null)
  const [operationalDayLoading, setOperationalDayLoading] = useState(false)
  const [operationalDayError, setOperationalDayError] = useState('')
  const [ledgerVersion, setLedgerVersion] = useState(0)
  const operationalDayListener = useRef(null)
  const saleInFlight = useRef(false)

  const downloadSalesBackup = useCallback(() => {
    const backup = buildSalesBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `pos101-sales-backup-${backup.createdAt.replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])


  const activeOrder = orders[active] || orders[0]
  const subtotal = orderSubtotal(activeOrder)
  const activeDiscount = discountValue(subtotal, activeOrder.discount)
  const total = Math.max(0, subtotal - activeDiscount)

  const openOrdersCount = getOpenOrders(orders).length

  const catalogProducts = useMemo(() => {
    const merged = new Map(products.map(product => [String(product.id), product]))
    for (const product of centralProducts) merged.set(String(product.id), { ...merged.get(String(product.id)), ...product })
    return [...merged.values()]
  }, [centralProducts])
  // Categories are navigation data, not a projection of the current product
  // list. Keep empty categories clickable so their empty state remains useful.
  const catalogCategories = useMemo(() => categories.slice(), [])
  const visibleProducts = useMemo(
    () => {
      const allChildren = new Map()
      const activeChildren = new Map()
      for (const product of catalogProducts) {
        if (!product.parentProductId) continue
        const key = String(product.parentProductId)
        const list = allChildren.get(key) || []
        list.push(product)
        allChildren.set(key, list)
        if (product.enabled !== false) {
          const active = activeChildren.get(key) || []
          active.push(product)
          activeChildren.set(key, active)
        }
      }
      const needle = query.trim().toLowerCase()
      return catalogProducts
        .filter(product => !product.parentProductId && product.enabled !== false)
        .map(product => ({ ...product, variantProducts: activeChildren.get(String(product.id)) || [] }))
        .filter(product => {
          const children = allChildren.get(String(product.id)) || []
          if (children.length > 0 && product.variantProducts.length === 0) return false
          const inCategory = categoryId(category) === categoryId('الكل') || categoryId(product.categoryId || product.category) === categoryId(category)
          const ownText = `${product.name || ''} ${product.english || ''}`.toLowerCase()
          const childText = product.variantProducts.map(child => `${child.name || ''} ${child.english || ''}`).join(' ').toLowerCase()
          return inCategory && (!needle || ownText.includes(needle) || childText.includes(needle))
        })
    },
    [catalogProducts, category, query]
  )

  useEffect(() => {
    if (!catalogCategories.includes(category)) setCategory('الكل')
  }, [catalogCategories, category])

  useEffect(() => {
    const settingsRoute = currentView === 'settings'
    document.documentElement.classList.toggle('settings-route', settingsRoute)
    document.body.classList.toggle('settings-route', settingsRoute)
    return () => {
      document.documentElement.classList.remove('settings-route')
      document.body.classList.remove('settings-route')
    }
  }, [currentView])

  // Persist state
  useEffect(() => localStorage.setItem('pos101.orders', JSON.stringify(orders)), [orders])
  useEffect(() => localStorage.setItem('pos101.nextNumber', nextNumber), [nextNumber])
  useEffect(() => localStorage.setItem('pos101.session', JSON.stringify(session)), [session])
  useEffect(() => localStorage.setItem('pos101.autoPrint', JSON.stringify(autoPrint)), [autoPrint])
  useEffect(() => localStorage.setItem('pos101.printerSettings', JSON.stringify(printerSettings)), [printerSettings])
  useEffect(() => localStorage.setItem('pos101.discountPresets', JSON.stringify(discountPresets)), [discountPresets])

  useEffect(() => {
    const stopAuth = subscribeCentralAuth(user => {
      centralListener.current?.()
      centralListener.current = null
      operationalDayListener.current?.()
      operationalDayListener.current = null
      productListener.current?.()
      productListener.current = null
      setCentralProducts([])
      setOperationalDay(null)
      setAdminAuthUser(isCentralAdminUser(user) ? user : null)
      setProductAuthUser(isCentralProductManager(user) ? user : null)
      setSyncLabel(user && isCentralAdminUser(user) ? 'تحديث المبيعات' : user && isCentralCashierUser(user) ? 'مزامنة' : 'المزامنة جاهزة')
      if (!user) {
        setSyncAuthStatus(null)
        return
      }
      if (isCentralAdminUser(user) || isCentralCashierUser(user)) {
        operationalDayListener.current = subscribeOperationalDay(setOperationalDay)
      }
      if (isCentralAdminUser(user) || isCentralCashierUser(user)) {
        productListener.current = subscribeCentralProducts(setCentralProducts)
      }
      if (isCentralAdminUser(user)) {
        centralListener.current = subscribeCentralSalesReadOnly(({ mergedSales }) => {
          setAdminCentralSales(mergedSales)
        })
        return
      }
      if (!isCentralCashierUser(user)) return
      centralListener.current = subscribeCentralSales(({ centralCount }) => {
        setSyncAuthStatus(current => current?.ok ? { ...current, centralCount } : current)
      })
      if (getCentralSyncState().initialSyncCompleted) {
        void runCashierCentralSync().catch(() => {})
      }
    })
    return () => {
      stopAuth?.()
      centralListener.current?.()
      productListener.current?.()
      operationalDayListener.current?.()
      setAdminCentralSales([])
      setProductAuthUser(null)
    }
  }, [])

  const operationalDaySummary = useMemo(() => {
    const expenses = read('pos101.expenses', [])
    return calculateOperationalDaySummary(readLocalSales(), expenses, operationalDay?.id)
  }, [operationalDay, ledgerVersion])

  useEffect(() => {
    const refreshOperationalSummary = () => setLedgerVersion(value => value + 1)
    window.addEventListener('pos101-sale-created', refreshOperationalSummary)
    window.addEventListener('pos101-sale-updated', refreshOperationalSummary)
    window.addEventListener('pos101-expenses-updated', refreshOperationalSummary)
    return () => {
      window.removeEventListener('pos101-sale-created', refreshOperationalSummary)
      window.removeEventListener('pos101-sale-updated', refreshOperationalSummary)
      window.removeEventListener('pos101-expenses-updated', refreshOperationalSummary)
    }
  }, [])

  const handleStartOperationalDay = useCallback(async () => {
    setOperationalDayError('')
    setOperationalDayLoading(true)
    try {
      if (!centralAuth()?.currentUser) await signInCentralWithGoogle()
      const day = await startOperationalDay({ startedBy: { name: session?.name || session?.shiftName || '' } })
      setOperationalDay(day)
      setModal(null)
    } catch (error) {
      setOperationalDayError(error?.message || 'تعذر بدء اليوم التشغيلي.')
      throw error
    } finally { setOperationalDayLoading(false) }
  }, [session])

  const handleEndOperationalDay = useCallback(async () => {
    setOperationalDayError('')
    try {
      const closed = await endOperationalDay(operationalDay, { endedBy: { name: session?.name || session?.shiftName || '' } })
      setOperationalDay(closed?.status === 'open' ? closed : null)
    } catch (error) {
      setOperationalDayError(error?.message || 'تعذر إنهاء اليوم التشغيلي.')
      throw error
    }
  }, [operationalDay, session])

  const loginAdmin = useCallback(async () => {
    if (adminAuthBusy) return
    setAdminAuthBusy(true)
    setAdminAuthError('')
    try {
      await signInAdminWithGoogle()
    } catch (error) {
      setAdminAuthError(error?.message || 'تعذر تسجيل دخول الإدارة.')
    } finally {
      setAdminAuthBusy(false)
    }
  }, [adminAuthBusy])

  const logoutAdmin = useCallback(async () => {
    setAdminAuthError('')
    await signOutCentral()
  }, [])

  const onCentralSyncStart = useCallback(() => {
    setSyncBusy(true)
    setSyncLabel(isCentralAdminUser(centralAuth()?.currentUser) ? 'جاري تحديث المبيعات...' : 'جاري المزامنة...')
  }, [])

  const onCentralSyncSuccess = useCallback(({ role, result }) => {
    const user = centralAuth()?.currentUser
    const providerId = user?.providerData?.[0]?.providerId || 'google.com'
    if (role === 'admin-viewer') {
      setAdminCentralSales(result.mergedSales)
      setSyncLabel('تم تحديث المبيعات')
      setSyncAuthStatus({ ok: true, role, uid: user?.uid, email: user?.email, providerId, uploaded: 0, centralCount: result.centralCount, mergedCount: result.mergedCount, readOnly: true, message: 'تم تحديث المبيعات' })
      return
    }
    setSyncLabel('تمت المزامنة')
    setSyncAuthStatus({ ok: true, uid: user?.uid, email: user?.email, providerId, uploaded: result.uploaded, centralCount: result.centralCount })
  }, [])

  const onCentralSyncError = useCallback(error => {
    setSyncLabel(navigator.onLine === false ? 'محلي - بانتظار الاتصال' : isCentralAdminUser(centralAuth()?.currentUser) ? 'تحديث المبيعات' : 'المزامنة جاهزة')
    setSyncAuthStatus({ ok: false, message: error?.message || 'تعذر تنفيذ المزامنة.' })
  }, [])

  const handleCentralSyncClick = useMemo(() => createCentralSyncClickHandler({
    getCurrentUser: () => centralAuth()?.currentUser,
    signIn: signInCentralWithGoogle,
    runAdminRefresh: runAdminCentralRefresh,
    runCashierSync: () => runCashierCentralSync({ initial: !getCentralSyncState().initialSyncCompleted }),
    onStart: onCentralSyncStart,
    onSuccess: onCentralSyncSuccess,
    onError: onCentralSyncError,
  }), [onCentralSyncStart, onCentralSyncSuccess, onCentralSyncError])

  useEffect(() => {
    const retry = () => {
      if (isCentralCashierUser(centralAuth()?.currentUser) && getCentralSyncState().initialSyncCompleted) {
        void runCashierCentralSync().catch(() => {})
      }
    }
    window.addEventListener('pos101-sale-created', retry)
    window.addEventListener('pos101-sale-updated', retry)
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('pos101-sale-created', retry)
      window.removeEventListener('pos101-sale-updated', retry)
      window.removeEventListener('online', retry)
    }
  }, [])

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
    const item = { ...p, price: p.unitPrice || p.price, lineId: `${p.id}-${Date.now()}` }
    update(o => {
      const variantLine = item.variantId || item.childProductId
      if (!variantLine) return { ...o, items: [...o.items, item] }
      const existing = o.items.find(current => String(current.variantId || current.childProductId || '') === String(variantLine))
      if (!existing) return { ...o, items: [...o.items, item] }
      return { ...o, items: o.items.map(current => current === existing ? { ...current, quantity: current.quantity + (item.quantity || 1) } : current) }
    })
    setCartScrollRequest(v => v + 1)
    setModal(null)
  }, [update])
  const selectProduct = useCallback(p => {
    if (p.variantProducts?.length) { setSelected(p); setModal('variants'); return }
    if (p.configurable) { setSelected(p); setModal('options'); return }
    addProduct({ ...p, quantity: 1 })
  }, [addProduct])
  const selectVariant = useCallback((parent, child) => {
    const parentName = parent.name || ''
    const childName = child.name || ''
    addProduct({
      ...child,
      name: `${parentName} - ${childName}`,
      displayName: `${parentName} - ${childName}`,
      english: parent.english && child.english ? `${parent.english} - ${child.english}` : child.english || parent.english,
      parentProductId: parent.id,
      childProductId: child.id,
      variantId: child.id,
      productId: child.id,
      productType: 'child',
      quantity: 1,
    })
  }, [addProduct])
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
    if (operationalDay?.status !== 'open') {
      setOperationalDayError('يجب بدء اليوم التشغيلي أولاً')
      setModal('operational-day-required')
      return false
    }
    setPendingPayment(payment)
    setModal('seller-selection')
    return true
  }, [session, activeOrder.items.length])

  const finalizeSale = useCallback(async (sellerName) => {
    if (!session || !activeOrder.items.length || saleInFlight.current || !pendingPayment) return false

    let currentOperationalDay = operationalDay
    try {
      currentOperationalDay = await readOpenOperationalDay()
    } catch {
      currentOperationalDay = null
    }
    if (!currentOperationalDay || currentOperationalDay.status !== 'open') {
      setOperationalDay(null)
      setOperationalDayError('يجب بدء اليوم التشغيلي أولاً')
      setModal('operational-day-required')
      return false
    }

    saleInFlight.current = true
    const payment = pendingPayment
    const originalItems = activeOrder.items.map(i => ({ ...i }))
    // The order owns the id before any network request.  A lost response must
    // retry this exact sale, including after a page refresh.
    const stableSaleId = activeOrder.saleId || crypto.randomUUID()
    const stableOperationKey = activeOrder.operationKey || `pos101:${stableSaleId}`
    if (!activeOrder.saleId || !activeOrder.operationKey) setOrders(v => v.map((o, i) => i === active ? { ...o, saleId: stableSaleId, operationKey: stableOperationKey } : o))

    const sale = {
      saleId: stableSaleId,
      id: stableSaleId,
      operationKey: stableOperationKey,
      orderNumber: nextNumber,
      cashierId: session.shiftId,
      cashierNameSnapshot: sellerName,
      shift: session.name,
      seller: sellerName,
      createdAt: Date.now(),
      businessDate: currentOperationalDay.businessDate,
      operationalDayId: currentOperationalDay.id,
      subtotal,
      discount: activeDiscount,
      discountDetails: activeOrder.discount ? { ...activeOrder.discount, value: activeDiscount } : null,
      total,
      paymentMethod: payment.method,
      payment,
      items: originalItems,
      order: { ...activeOrder, items: originalItems }
    }

    // 1. Optimistic Local Save & Cart Clear (POS continues selling)
    setNextNumber(n => n + 1)
    setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
    if (autoPrint || payment.forcePrint) void requestSalePrint(sale)
    setPendingPayment(null)
    window.setTimeout(() => setModal(null), 350)

    // 2. Persist the local ledger and deferred queue. No Firebase, ACC, Auth,
    // or Cloud Function call is allowed on this cashier-critical path.
    enqueueSale(sale)
    window.setTimeout(() => { saleInFlight.current = false }, 350)
    return true
  }, [session, activeOrder, nextNumber, subtotal, total, activeDiscount, active, autoPrint, pendingPayment, requestSalePrint, operationalDay])

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
    const reportDate = report.reportDate || report.dateFrom
    const datasetKey = (report.sales || []).map(sale => sale.saleId || sale.id || sale.orderNumber).join(',') || 'empty'
    const jobId = `report:${report.reportType}:${reportDate}:${datasetKey}`
    void printThermalDocument({ settings: printerSettings, jobId, document: { kind: 'report', report } })
      .then(result => setPrintMessage({ text: result.duplicate ? 'تم تجاهل إعادة إرسال التقرير المكرر.' : 'تم إرسال التقرير للطابعة الحرارية مباشرة.' }))
      .catch(error => setPrintMessage({ text: `تعذر إرسال التقرير للطابعة الحرارية: ${error.message}` }))
    return true
  }, [directThermalReady, printerSettings])
  const login = useCallback(async cashier => {
    setSession({
      cashierId: cashier.cashierId || cashier.shiftId,
      cashierNameSnapshot: cashier.name,
      shiftId: cashier.shiftId,
      shiftName: cashier.name,
      name: cashier.name,
      openedAt: Date.now(),
      status: 'open',
      localOnly: true,
    })
    setModal(null)
  }, [])
  const logout = useCallback(async () => {
    if (session) {
      const shifts = read('pos101.shifts', [])
      localStorage.setItem('pos101.shifts', JSON.stringify([...shifts, { ...session, closedAt: Date.now(), status: 'closed' }]))
    }
    setSession(null); setModal(null)
  }, [session])
  const clearCart = useCallback(() => update(o => ({ ...o, items: [], discount: null, table: null, orderType: null, held: false })), [update])

  const adminReady = isCentralAdminUser(adminAuthUser)
  const productManagerReady = isCentralProductManager(productAuthUser)
  const saveProduct = useCallback(async product => {
    const saved = await saveCentralProduct(product)
    setCentralProducts(current => [...current.filter(item => String(item.id) !== String(saved.id)), saved])
    return saved
  }, [])

  return (
    <main className={`app-shell ${currentView === 'settings' ? 'settings-app-shell' : ''}`}>
      {session && (
        <Header
          session={session}
          onOpenOrders={() => setModal('openOrders')}
          onCashierMenu={() => setModal('cashier-menu')}
          onLogout={logout}
          openOrdersCount={openOrdersCount}
          onDownloadSalesBackup={downloadSalesBackup}
          currentView={currentView}
          onNavigate={setCurrentView}
        />
      )}

      {currentView === 'dashboard' && (session || adminReady) && (
        <Dashboard onNavigate={setCurrentView} onLogout={logout} operationalDayEnabled={Boolean(session || adminReady)} operationalDay={operationalDay} operationalDaySummary={operationalDaySummary} operationalDayLoading={operationalDayLoading} operationalDayError={operationalDayError} onStartOperationalDay={handleStartOperationalDay} onEndOperationalDay={handleEndOperationalDay} />
      )}

      {currentView === 'settings' && (session || adminReady) && (
        <Settings products={catalogProducts} categories={catalogCategories} canWrite={productManagerReady} onSave={saveProduct} onNavigate={setCurrentView} discountPresets={discountPresets} onDiscountPresetsChange={value => setDiscountPresets(normalizeDiscountPresets(value))} autoPrint={autoPrint} onAutoPrintChange={setAutoPrint} />
      )}

      {currentView === 'orders' && (session || adminReady) && (
        <OrderHistoryMenu
          session={session}
          salesOverride={adminReady ? adminCentralSales : null}
          readOnly
          onClose={() => setCurrentView('dashboard')}
        />
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

      {currentView === 'reports' && session && <Reports session={session} operationalDay={operationalDay} onNavigate={setCurrentView} onDirectThermalPrint={printReportDirect} directThermalReady={directThermalReady} />}
      {currentView === 'expenses' && session && (
        <Expenses session={session} operationalDay={operationalDay} onNavigate={setCurrentView} />
      )}
      {currentView === 'purchases' && session && <Purchases session={session} onNavigate={setCurrentView} />}
      {currentView === 'expense-entry' && session && (
        <Expenses session={session} operationalDay={operationalDay} onNavigate={setCurrentView} />
      )}
      {currentView === 'reports-captain' && session && <Reports session={session} onNavigate={setCurrentView} />}

      {adminReady && !session && currentView === 'dashboard' && (
        <section className="admin-central-readonly" dir="rtl" aria-label="مركز مبيعات الإدارة">
          <header className="admin-central-head">
            <div><h1>الإدارة متصلة</h1><p>قراءة مركزية مباشرة — {adminCentralSales.length} مبيعات فريدة</p></div>
            <button className="secondary-action" type="button" onClick={logoutAdmin}>تسجيل خروج الإدارة</button>
          </header>
          <div className="admin-central-actions"><span>وضع الإدارة: قراءة فقط · الرفع محظور</span></div>
          <div className="admin-central-table-wrap"><table className="history-table"><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>الكاشير</th><th>الدفع</th><th>الإجمالي</th></tr></thead><tbody>{adminCentralSales.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).map(sale => <tr key={sale.saleId}><td>{sale.orderNumber || '—'}</td><td>{new Date(sale.createdAt).toLocaleString('ar-IQ')}</td><td>{sale.cashierNameSnapshot || sale.seller || '—'}</td><td>{sale.paymentMethod || sale.payment?.method || '—'}</td><td>{formatNumber(sale.total || 0)}</td></tr>)}</tbody></table></div>
          <Reports session={{ name: 'الإدارة', status: 'admin-readonly' }} salesOverride={adminCentralSales} onNavigate={() => {}} />
        </section>
      )}

      {/* Login gate */}
      {!session && !adminReady && (
        <ShiftLogin
          shifts={shifts}
          onClose={() => {}}
          onLogin={login}
          onAdminLogin={loginAdmin}
          onAdminLogout={logoutAdmin}
          adminUser={adminAuthUser}
          adminBusy={adminAuthBusy}
          adminError={adminAuthError}
        />
      )}

      {/* Modals */}
      {modal === 'cashier-menu' && <CashierMenu session={session} onClose={() => setModal(null)} onLogout={logout} />}
      {modal === 'operational-day-required' && <div className="overlay"><div className="dialog operational-day-required-dialog" dir="rtl"><h2>يجب بدء اليوم التشغيلي أولاً</h2><p>لن يتم إكمال البيع أو مسح السلة قبل بدء يوم تشغيلي مركزي.</p><div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setModal(null)}>رجوع</button><button type="button" className="primary-action" disabled={operationalDayLoading} onClick={handleStartOperationalDay}>{operationalDayLoading ? 'جارٍ بدء اليوم…' : 'بدء اليوم'}</button></div></div></div>}
      {modal === 'confirm-clear' && <ConfirmDialog title="تفريغ سلة المشتريات" message="سيتم مسح العناصر الحالية ولا يمكن التراجع عن العملية." onClose={() => setModal(null)} onConfirm={() => { clearCart(); setModal(null) }} />}
      {modal === 'print-menu' && <PrintMenu enabled={autoPrint} settings={printerSettings} thermalStatus={thermalStatus} onClose={() => setModal(null)} onChange={v => setAutoPrint(v)} onSave={savePrinterSettings} onCheck={settings => refreshThermalStatus({ ...printerSettings, ...settings })} onDirectChange={v => setPrinterSettings(s => ({ ...s, directThermal: v }))} />}
      {modal === 'options' && <ProductOptions product={selected} onClose={() => setModal(null)} onAdd={addProduct} />}
      {modal === 'variants' && selected && <VariantModal product={selected} variants={selected.variantProducts || []} onClose={() => setModal(null)} onSelect={child => selectVariant(selected, child)} />}
      {modal === 'orderType' && <OrderType onClose={() => setModal(null)} onChoose={chooseType} />}
      {modal === 'tables' && <TableSelection orders={orders} onClose={() => setModal(null)} onChoose={chooseTable} />}
      {modal === 'payment' && <Payment total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'quickCash' && <QuickCash total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'seller-selection' && <SellerSelection onClose={() => setModal(null)} onSelect={finalizeSale} />}
      {modal === 'discount' && <DiscountDialog subtotal={subtotal} current={activeOrder.discount} presets={discountPresets} onClose={() => setModal(null)} onApply={applyDiscount} />}
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
      {syncAuthStatus && (
        <div className={`print-status ${syncAuthStatus.ok ? '' : 'error'}`} role="status">
          {syncAuthStatus.ok ? (
            <span>{syncAuthStatus.message || 'تمت المزامنة'}{!syncAuthStatus.readOnly && Number.isFinite(syncAuthStatus.uploaded) ? ` — ${syncAuthStatus.uploaded} مبيعات جديدة` : ''}</span>
          ) : (
            <span>{syncAuthStatus.message}</span>
          )}
          <button type="button" aria-label="إغلاق حالة تسجيل دخول المزامنة" onClick={() => setSyncAuthStatus(null)}>×</button>
        </div>
      )}
    </main>
  )
}
