import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import OrderPanel from './components/OrderPanel'
import { ProductOptions, VariantModal, OrderType, TableSelection, Payment, QuickCash, DiscountDialog, OpenOrders, History, ReturnDialog, Receipt, ShiftLogin, FinancialPinDialog, SellerSelection, CashierMenu, ConfirmDialog, PrintMenu } from './components/Dialogs'
import PendingTables from './components/PendingTables.jsx'
import SavePendingTableDialog from './components/SavePendingTableDialog.jsx'
import OrderHistoryMenu from './components/OrderHistoryMenu'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'
import Employees from './components/Employees'
import FinancialCenter from './components/FinancialCenter'
import Reports from './components/Reports'
import { Expenses } from './components/Expenses'
import { Purchases } from './components/Purchases'
import { categories, products, categoryId } from './data/menu'
import { Icon } from './components/Icons'
import { checkThermalService, defaultThermalSettings, printThermalDocument } from './services/thermalPrinter'
import { enqueueSale, buildSalesBackup } from './services/salesSyncQueue'
import { activateKioskWithCode, allocateCentralOrderNumber, canManageStaff, canSyncPosSales, centralAuth, correctCentralSaleItems, ensureKioskFirebaseSession, getCentralSyncState, isCentralAdminUser, isCentralCashierUser, isCentralConfigured, isCentralProductManager, isKioskAuthenticatedUser, recoverStaleEmergencyRepairFlag, recoverStaleSyncLock, refreshCentralAuthorizationRecord, readCachedOperationalDay, readCentralOperationalDays, readEndDayDiagnostic, readFreshSettlementPreview, readOpeningCashSuggestion, readLocalExpenses, readPreCloseReconciliation, runAdminCentralRefresh, runCashierCentralSync, runCashierCentralSyncNow, runExpenseCentralSync, runNewSaleSyncDiagnostic, saveCentralProduct, saveCashierPin, signInAdminWithGoogle, signOutCentral, subscribeCentralAuth, subscribeCentralReconnect, subscribeCentralExpenses, subscribeCentralProducts, subscribeCentralSales, subscribeCentralSalesReadOnly, subscribeOperationalDay, startOperationalDay, setOperationalDayOpeningCashBalance, settleAndEndOperationalDay, readOpenOperationalDay, subscribeCentralStaff, readCentralStaff, subscribeCentralCashboxTransactions, subscribeCentralSettlements, subscribeCentralSettlementCorrections, saveSettlementCorrection, saveCentralStaff, saveCashboxTransaction, updateCashboxTransaction, voidCashboxTransaction, saveCashCount, updateCentralSale, subscribePendingTables, savePendingTable, updatePendingTable, payPendingTable, transitionPendingTable } from './services/posCentralSync.js'
import { createCentralSyncClickHandler } from './services/centralSyncController.js'
import { formatNumber } from './utils.js'
import { getOpenOrders } from './services/orderState.js'
import { VERSION_CHECK_INTERVAL_MS, createVersionController, installServiceWorker } from './services/versionUpdate.js'
import { readLocalSales } from './services/reportSales.js'
import { calculateOperationalDaySummary } from './services/operationalDayReport.js'
import { canonicalSalesForOperationalDay, reconcileCanonicalSales } from './services/canonicalSales.js'
import { calculateSettlement } from './services/financialCenter.js'
import KioskActivation from './components/KioskActivation.jsx'
import SalesBackupRecovery from './components/SalesBackupRecovery.jsx'
import { clearFinancialPinUnlock, isFinancialPinUnlocked, saveFinancialPinUnlock, verifyCashierPin } from './services/cashierPin.js'
import { createCashierQueueWorker } from './services/cashierQueueWorker.js'
import { BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED, TEMP_OPEN_ONE_BUTTON_REPAIR, inspectBackupSales, markBackupSaleReadbackLocally, recoverBackupSale, runOneClickSyncRepair } from './services/posCentralSync.js'

const blankOrder = index => ({ id: index, name: `طلب ${index}`, items: [], table: null, orderType: null, held: false, completed: false, adjustments: [] })
const ensureOrderSlots = (value, count = 10) => {
  const list = Array.isArray(value) ? value.slice() : []
  const usedIds = new Set(list.map(order => Number(order?.id)).filter(Number.isFinite))
  let nextId = 1
  while (list.length < count) {
    while (usedIds.has(nextId)) nextId += 1
    list.push(blankOrder(nextId))
    usedIds.add(nextId)
    nextId += 1
  }
  return list
}
export const tablesEnabled = false
const read = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw) } catch { return fallback } }
const orderSubtotal = order => order.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
export const DEFAULT_DISCOUNT_PRESETS = { baly: 26, toters: 25 }
const normalizeDiscountPresets = value => ({
  baly: Math.min(100, Math.max(0, Number.isFinite(Number(value?.baly)) ? Number(value.baly) : DEFAULT_DISCOUNT_PRESETS.baly)),
  toters: Math.min(100, Math.max(0, Number.isFinite(Number(value?.toters)) ? Number(value.toters) : DEFAULT_DISCOUNT_PRESETS.toters)),
})
const discountValue = (subtotal, discount, discountPresets = DEFAULT_DISCOUNT_PRESETS) => {
  if (!discount) return 0
  const raw = Number(discount.input)
  const input = Number.isFinite(raw) && raw > 0 ? raw : 0
  const percentage = discount.kind === 'baly' ? discountPresets.baly
    : discount.kind === 'toters' ? discountPresets.toters
      : discount.kind === 'percent' ? Math.min(100, input) : null
  const value = percentage === null ? input : Math.round(subtotal * percentage / 100)
  return Math.min(subtotal, Math.max(0, value))
}
const recalculateDiscount = (order, discountPresets) => {
  if (!order.discount) return order
  return { ...order, discount: { ...order.discount, value: discountValue(orderSubtotal(order), order.discount, discountPresets) } }
}
const shifts = [
  { shiftId: 'morning', name: 'كاشير صباحي' },
  { shiftId: 'evening', name: 'كاشير مسائي' }
]

const LEGACY_STAFF_NAME_FIELDS = ['seller', 'cashierNameSnapshot', 'cashierName', 'employeeNameSnapshot', 'employeeName', 'captainName']
const LEGACY_STAFF_ARRAY_FIELDS = ['employees', 'employeeNames', 'captains', 'captainNames', 'legacyEmployees', 'legacyCaptains']
const normalizeLegacyStaffName = value => String(value || '').trim()
const legacyStaffNamesFromValue = value => {
  if (typeof value === 'string') return [normalizeLegacyStaffName(value)].filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(legacyStaffNamesFromValue)
  if (!value || typeof value !== 'object') return []
  return [...LEGACY_STAFF_NAME_FIELDS, 'name'].flatMap(field => legacyStaffNamesFromValue(value[field]))
}
const collectLegacyStaffNames = sales => [...new Set((sales || []).flatMap(sale => [
  ...LEGACY_STAFF_NAME_FIELDS.flatMap(field => legacyStaffNamesFromValue(sale?.[field])),
  ...LEGACY_STAFF_ARRAY_FIELDS.flatMap(field => legacyStaffNamesFromValue(sale?.[field])),
]))].filter(Boolean)
const stableStaffId = name => `staff-${encodeURIComponent(name).replace(/%/g, '').replace(/[^a-zA-Z0-9\u0600-\u06ff_-]/g, '-').replace(/-+/g, '-').slice(0, 80)}`

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard')
  const [orders, setOrders] = useState(() => ensureOrderSlots(read('pos101.orders', []), 10))
  const [active, setActive] = useState(0)
  const [category, setCategory] = useState('الكل')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [financialPinTarget, setFinancialPinTarget] = useState(null)
  const [selected, setSelected] = useState(null)
  const [printSale, setPrintSale] = useState(null)
  const [printMessage, setPrintMessage] = useState(null)
  const [session, setSession] = useState(() => read('pos101.session', null))
  const [autoPrint, setAutoPrint] = useState(() => read('pos101.autoPrint', true))
  const [discountPresets, setDiscountPresets] = useState(() => normalizeDiscountPresets(read('pos101.discountPresets', DEFAULT_DISCOUNT_PRESETS)))
  const [printerSettings, setPrinterSettings] = useState(() => ({ ...defaultThermalSettings, ...read('pos101.printerSettings', {}) }))
  const [thermalStatus, setThermalStatus] = useState(null)
  const [versionStatus, setVersionStatus] = useState('idle')
  const [dirtyFinancialForm, setDirtyFinancialForm] = useState(false)
  const [cartScrollRequest, setCartScrollRequest] = useState(0)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncLabel, setSyncLabel] = useState('المزامنة جاهزة')
  const [syncAuthStatus, setSyncAuthStatus] = useState(null)
  const [adminAuthUser, setAdminAuthUser] = useState(null)
  const [adminAuthBusy, setAdminAuthBusy] = useState(false)
  const [adminAuthError, setAdminAuthError] = useState('')
  const [centralAuthUser, setCentralAuthUser] = useState(null)
  const [centralAuthReady, setCentralAuthReady] = useState(() => !isCentralConfigured())
  const [staffAuthorizationRecord, setStaffAuthorizationRecord] = useState(null)
  const [staffAuthBusy, setStaffAuthBusy] = useState(false)
  const [staffAuthError, setStaffAuthError] = useState('')
  const [kioskActivationBusy, setKioskActivationBusy] = useState(false)
  const [kioskActivationError, setKioskActivationError] = useState('')
  const [productAuthUser, setProductAuthUser] = useState(null)
  const [adminCentralSales, setAdminCentralSales] = useState([])
  const [centralSales, setCentralSales] = useState([])
  const [pendingTables, setPendingTables] = useState([])
  const [centralOperationalDays, setCentralOperationalDays] = useState([])
  const centralListener = useRef(null)
  const productListener = useRef(null)
  const [centralProducts, setCentralProducts] = useState([])
  const [operationalDay, setOperationalDay] = useState(() => readCachedOperationalDay())
  const [operationalDayLoading, setOperationalDayLoading] = useState(false)
  const [operationalDayError, setOperationalDayError] = useState('')
  const [preCloseGuard, setPreCloseGuard] = useState({ loading: false, state: 'unknown', allowed: true, message: '' })
  const [freshSettlementPreview, setFreshSettlementPreview] = useState(null)
  const [ledgerVersion, setLedgerVersion] = useState(0)
  const operationalDayListener = useRef(null)
  const expenseListener = useRef(null)
  const staffListener = useRef(null)
  const cashboxListener = useRef(null)
  const settlementListener = useRef(null)
  const [staff, setStaff] = useState([])
  const [staffStatus, setStaffStatus] = useState({ state: 'idle', error: '' })
  const [cashboxTransactions, setCashboxTransactions] = useState([])
  const [settlements, setSettlements] = useState([])
  const settlementCorrectionListener = useRef(null)
  const pendingTablesListener = useRef(null)
  const [settlementCorrections, setSettlementCorrections] = useState([])
  const saleInFlight = useRef(false)
  const staffMigrationAttempted = useRef(false)
  const staffAuthInFlight = useRef(null)

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
  const activeDiscount = discountValue(subtotal, activeOrder.discount, discountPresets)
  const total = Math.max(0, subtotal - activeDiscount)

  const openOrdersCount = getOpenOrders(orders).length

  const versionBlocked = Boolean(activeOrder?.items?.length || dirtyFinancialForm)
  const versionBlockedRef = useRef(versionBlocked)
  versionBlockedRef.current = versionBlocked
  useEffect(() => {
    let alive = true
    let controller
    let timer
    const check = () => { void controller?.check() }
    const onFormDirty = event => setDirtyFinancialForm(Boolean(event.detail?.dirty))
    const onVisibility = () => { if (!document.hidden) check() }
    const onFocus = () => check()
    const onSafe = () => { void controller?.applyWhenSafe() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pos101-form-dirty', onFormDirty)
    window.addEventListener('pos101-update-safe', onSafe)
    void (async () => {
      const registration = await installServiceWorker()
      if (!alive) return
      controller = createVersionController({ registration, getBlocked: () => versionBlockedRef.current, setStatus: status => alive && setVersionStatus(status) })
      await controller.check()
      timer = window.setInterval(check, VERSION_CHECK_INTERVAL_MS)
    })()
    return () => { alive = false; if (timer) window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onFocus); window.removeEventListener('pos101-form-dirty', onFormDirty); window.removeEventListener('pos101-update-safe', onSafe) }
  }, [])

  useEffect(() => { window.dispatchEvent(new CustomEvent('pos101-update-guard', { detail: { blocked: versionBlocked } })) }, [versionBlocked])
  useEffect(() => { if (!versionBlocked) window.dispatchEvent(new Event('pos101-update-safe')) }, [versionBlocked])

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
    const cashboxRoute = currentView === 'cashbox'
    document.documentElement.classList.toggle('cashbox-route', cashboxRoute)
    const employeesRoute = currentView === 'employees'
    document.documentElement.classList.toggle('employees-route', employeesRoute)
    const reportsRoute = currentView === 'reports' || currentView === 'reports-captain'
    const backupRecoveryRoute = currentView === 'backup-recovery'
    document.documentElement.classList.toggle('reports-route', reportsRoute)
    document.documentElement.classList.toggle('backup-recovery-open', backupRecoveryRoute)
    document.body.classList.toggle('settings-route', settingsRoute)
    document.body.classList.toggle('cashbox-route', cashboxRoute)
    document.body.classList.toggle('employees-route', employeesRoute)
    document.body.classList.toggle('reports-route', reportsRoute)
    document.body.classList.toggle('backup-recovery-open', backupRecoveryRoute)
    return () => {
      document.documentElement.classList.remove('settings-route')
      document.body.classList.remove('settings-route')
      document.documentElement.classList.remove('cashbox-route')
      document.body.classList.remove('cashbox-route')
      document.documentElement.classList.remove('employees-route')
      document.body.classList.remove('employees-route')
      document.documentElement.classList.remove('reports-route')
      document.body.classList.remove('reports-route')
      document.documentElement.classList.remove('backup-recovery-open')
      document.body.classList.remove('backup-recovery-open')
    }
  }, [currentView])

  // Persist state
  useEffect(() => localStorage.setItem('pos101.orders', JSON.stringify(orders)), [orders])
  useEffect(() => localStorage.setItem('pos101.session', JSON.stringify(session)), [session])
  useEffect(() => localStorage.setItem('pos101.autoPrint', JSON.stringify(autoPrint)), [autoPrint])
  useEffect(() => localStorage.setItem('pos101.discountPresets', JSON.stringify(discountPresets)), [discountPresets])
  useEffect(() => localStorage.setItem('pos101.printerSettings', JSON.stringify(printerSettings)), [printerSettings])
  useEffect(() => {
    if (operationalDay?.status === 'open' && operationalDay.id && operationalDay.businessDate) {
      localStorage.setItem('pos101.operationalDay', JSON.stringify(operationalDay))
    }
  }, [operationalDay])

  useEffect(() => {
    const stopAuth = subscribeCentralAuth(user => {
      setCentralAuthReady(true)
      setCentralAuthUser(user)
      setStaffAuthError('')
      if (user && !isCentralCashierUser(user)) void refreshCentralAuthorizationRecord(user).then(record => {
        setStaffAuthorizationRecord(record)
        if (!record) setStaffAuthError(`AUTHORIZED_RECORD = MISSING\nUID = ${user.uid || '—'}\nEMAIL = ${user.email || '—'}`)
      }).catch(error => {
        console.error('STAFF_AUTHORIZATION_READ_ERROR', error)
        setStaffAuthorizationRecord(null)
      })
      else setStaffAuthorizationRecord(null)
      centralListener.current?.()
      centralListener.current = null
      operationalDayListener.current?.()
      operationalDayListener.current = null
      expenseListener.current?.()
      expenseListener.current = null
      staffListener.current?.(); staffListener.current = null
      cashboxListener.current?.(); cashboxListener.current = null
      settlementListener.current?.(); settlementListener.current = null
      settlementCorrectionListener.current?.(); settlementCorrectionListener.current = null
      pendingTablesListener.current?.(); pendingTablesListener.current = null
      productListener.current?.()
      productListener.current = null
      setCentralProducts([])
      setCentralSales([])
      setCentralOperationalDays([])
      setPendingTables([])
      staffMigrationAttempted.current = false
      setAdminAuthUser(isCentralAdminUser(user) ? user : null)
      setProductAuthUser(isCentralProductManager(user) ? user : null)
      setSyncLabel(user && isCentralAdminUser(user) ? 'تحديث المبيعات' : user && isCentralCashierUser(user) ? 'مزامنة' : 'المزامنة جاهزة')
      if (!user) {
        setSyncAuthStatus(null)
        return
      }
      void readCentralOperationalDays().then(days => {
        if (centralAuth()?.currentUser?.uid === user.uid) setCentralOperationalDays(Array.isArray(days) ? days : [])
      }).catch(error => console.error('OPERATIONAL_DAYS_READ_ERROR', error))
      if (isCentralAdminUser(user) || isCentralCashierUser(user)) {
        cashboxListener.current = subscribeCentralCashboxTransactions(setCashboxTransactions)
        settlementListener.current = subscribeCentralSettlements(setSettlements)
        settlementCorrectionListener.current = subscribeCentralSettlementCorrections(setSettlementCorrections)
        operationalDayListener.current = subscribeOperationalDay(setOperationalDay)
        pendingTablesListener.current = subscribePendingTables(setPendingTables)
        // Migrate the device cache before attaching the listener. Otherwise an
        // initial empty RTDB snapshot could overwrite legacy local expenses.
        void runExpenseCentralSync({ initial: true }).then(() => {
          if (centralAuth()?.currentUser?.uid !== user.uid) return
          expenseListener.current?.()
          expenseListener.current = subscribeCentralExpenses(() => setLedgerVersion(value => value + 1))
        }).catch(error => {
          console.error('EXPENSE_INITIAL_SYNC_ERROR', error)
          if (centralAuth()?.currentUser?.uid !== user.uid) return
          expenseListener.current?.()
          expenseListener.current = subscribeCentralExpenses(() => setLedgerVersion(value => value + 1))
        })
      }
      if (isCentralAdminUser(user) || isCentralCashierUser(user)) {
        productListener.current = subscribeCentralProducts(setCentralProducts)
      }
       if (!isCentralAdminUser(user) && !isCentralCashierUser(user)) return
       centralListener.current = subscribeCentralSales(({ centralSales: receivedSales, centralCount, mergedSales }) => {
         if (receivedSales) setCentralSales(receivedSales)
         if (mergedSales) setAdminCentralSales(mergedSales)
        setSyncAuthStatus(current => current?.ok ? { ...current, centralCount } : current)
      })
      if (isCentralCashierUser(user)) {
        window.dispatchEvent(new Event('auth-ready'))
      }
    })
    return () => {
      stopAuth?.()
      centralListener.current?.()
      productListener.current?.()
      operationalDayListener.current?.()
      expenseListener.current?.()
      staffListener.current?.()
      cashboxListener.current?.()
      settlementListener.current?.()
      settlementCorrectionListener.current?.()
      pendingTablesListener.current?.()
      setAdminCentralSales([])
      setProductAuthUser(null)
    }
  }, [])

  useEffect(() => {
    if (!centralAuthUser || !canManageStaff(centralAuthUser, staffAuthorizationRecord)) {
      setStaffStatus({ state: 'idle', error: '' })
      return
    }
    let active = true
    setStaffStatus({ state: 'loading', error: '' })
    const loadStaff = async () => {
      try {
        const rows = await readCentralStaff()
        if (!active) return
        console.info('STAFF_AUTH_OK')
        console.info('STAFF_DIRECT_READ_COUNT', rows.length)
        console.info('STAFF_DIRECT_READ_NAMES', rows.map(row => row.name).join('، '))
        setStaff(rows)
        setStaffStatus({ state: rows.length ? 'ready' : 'empty', error: '' })
        console.info('STAFF_SET_STATE_COUNT', rows.length)
        staffListener.current = subscribeCentralStaff(rows => {
          if (!active) return
          setStaff(rows)
          setStaffStatus({ state: rows.length ? 'ready' : 'empty', error: '' })
          console.info('STAFF_SET_STATE_COUNT', rows.length)
        }, error => {
          if (!active) return
          console.error('STAFF_SUBSCRIBE_ERROR', error?.code || 'UNKNOWN')
          setStaffStatus({ state: 'error', error: error?.message || 'تعذر قراءة قائمة الموظفين المركزية.' })
        })
      } catch (error) {
        console.error('STAFF_DIRECT_READ_ERROR', error)
        if (active) setStaffStatus({ state: 'error', error: error?.message || 'تعذر قراءة قائمة الموظفين المركزية.' })
      }
    }
    void loadStaff()
    return () => {
      active = false
      staffListener.current?.()
      staffListener.current = null
    }
  }, [centralAuthUser?.uid, staffAuthorizationRecord?.role, staffAuthorizationRecord?.active, staffAuthorizationRecord?.authorized])

  useEffect(() => {
    if (staffMigrationAttempted.current || !canManageStaff(centralAuth()?.currentUser) || !centralSales.length) return
    const candidates = collectLegacyStaffNames(centralSales)
    if (!candidates.length) {
      staffMigrationAttempted.current = true
      return
    }
    void (async () => {
      let current = await readCentralStaff()
      for (const name of candidates) {
        const stableId = stableStaffId(name)
        if (current.some(item => item.name === name || item.id === stableId)) continue
        const saved = await saveCentralStaff({ id: stableId, name, role: 'employee', active: true, code: '', source: 'legacy-sales' }, { actor: { reason: 'one-time migration from pos101_sales and legacy employee fields' } })
        current = [...current, saved]
      }
      const after = await readCentralStaff()
      setStaff(after)
      staffMigrationAttempted.current = true
    })().catch(error => {
      console.warn('STAFF_MIGRATION_NOT_COMPLETED', error?.code || error?.message || 'unknown')
    })
  }, [productAuthUser, centralSales, staff.length])

  const operationalDaySummary = useMemo(() => {
    const expenses = readLocalExpenses()
    const localSales = readLocalSales()
    const daySales = canonicalSalesForOperationalDay({ localSales, centralSales, operationalDay })
    return calculateOperationalDaySummary(daySales, expenses, operationalDay?.id)
  }, [operationalDay, centralSales, ledgerVersion])

  useEffect(() => {
    if (!operationalDay?.id || operationalDay.status !== 'open') {
      setPreCloseGuard({ loading: false, state: 'unknown', allowed: true, message: '' })
      return undefined
    }
    let active = true
    setPreCloseGuard({ loading: true, state: 'loading', allowed: false, message: '' })
    void readPreCloseReconciliation(operationalDay, { openOrderCount: openOrdersCount }).then(result => {
      if (!active) return
      setPreCloseGuard({ ...result, loading: false, state: result?.allowed ? 'verified' : 'real-pending', allowed: Boolean(result?.allowed), message: result?.allowed ? '' : (result?.message || 'تعذر التحقق من حالة الإغلاق.') })
    }).catch(error => {
      if (!active) return
      setPreCloseGuard({ loading: false, state: 'real-pending', allowed: false, message: error?.message || 'تعذر التحقق من مزامنة المبيعات.' })
    })
    return () => { active = false }
  }, [operationalDay?.id, operationalDay?.status, ledgerVersion, centralAuthUser?.uid, openOrdersCount])

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

  const prepareStartOperationalDay = useCallback(async () => readOpeningCashSuggestion(), [])

  const readDiagnostic = useCallback(() => readEndDayDiagnostic(operationalDay, { openOrderCount: openOrdersCount, preCloseGuard }), [operationalDay, openOrdersCount, preCloseGuard])

  const handleStartOperationalDay = useCallback(async ({ openingCashBalance, openingCashSource = 'manual', previousOperationalDayId = '', openingCashAdjustmentNote = '' } = {}) => {
    setOperationalDayError('')
    setOperationalDayLoading(true)
    try {
      const day = await startOperationalDay({ openingCashBalance, openingCashSource, previousOperationalDayId, openingCashAdjustmentNote, startedBy: { name: session?.name || session?.shiftName || '' } })
      setOperationalDay(day)
      setFreshSettlementPreview(null)
      setModal(null)
    } catch (error) {
      setOperationalDayError(error?.message || 'تعذر بدء اليوم التشغيلي.')
      throw error
    } finally { setOperationalDayLoading(false) }
  }, [session])

  const prepareEndOperationalDay = useCallback(async () => {
    const fresh = await readFreshSettlementPreview(operationalDay)
    setFreshSettlementPreview(fresh)
    const guard = await readPreCloseReconciliation(operationalDay, { openOrderCount: openOrdersCount })
    const reconciliation = reconcileCanonicalSales({ localSales: readLocalSales(), centralSales, operationalDay })
    if (!guard.allowed || !reconciliation.allowed) {
      const message = guard.message || 'تعذر مطابقة المبيعات المحلية والمركزية قبل التسوية.'
      setPreCloseGuard({ ...guard, loading: false, state: 'real-pending', allowed: false, message, financialReconciliation: reconciliation })
      throw Object.assign(new Error(message), { code: 'PRE_CLOSE_RECONCILIATION_BLOCKED', preClose: { ...guard, financialReconciliation: reconciliation } })
    }
    setPreCloseGuard({ ...guard, loading: false, state: 'verified', allowed: true, message: '', financialReconciliation: reconciliation })
  }, [operationalDay, openOrdersCount, centralSales])

  const handleEndOperationalDay = useCallback(async actualCash => {
    setOperationalDayError('')
    try {
      const result = await settleAndEndOperationalDay(operationalDay, { actualCash, openOrderCount: openOrdersCount, endedBy: { name: session?.name || session?.shiftName || '' } })
      const reopened = await readOpenOperationalDay()
      setOperationalDay(reopened)
      setFreshSettlementPreview(null)
      return result
    } catch (error) {
      console.error('END_DAY_SUBMIT_ERROR', { code: error?.code || '', message: error?.message || String(error) })
      setOperationalDayError(error?.message || 'تعذر إنهاء اليوم التشغيلي.')
      throw error
    }
  }, [operationalDay, session, openOrdersCount])

  const handleSetOpeningCashBalance = useCallback(async ({ openingCashBalance, reason } = {}) => {
    setOperationalDayError('')
    try {
      const result = await setOperationalDayOpeningCashBalance(operationalDay, { openingCashBalance, reason })
      setOperationalDay(result.day)
      setFreshSettlementPreview(await readFreshSettlementPreview(result.day))
      return result
    } catch (error) {
      setOperationalDayError(error?.message || 'تعذر تحديث رصيد الافتتاح.')
      throw error
    }
  }, [operationalDay])

  const settlementPreview = useMemo(() => {
    const dayId = operationalDay?.id
    const dayDate = operationalDay?.businessDate
    return freshSettlementPreview || calculateSettlement({
      openingCashBalance: operationalDay?.openingCashBalance || 0,
      sales: readLocalSales().filter(row => row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === dayDate)),
      expenses: readLocalExpenses().filter(row => row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === dayDate)),
      transactions: cashboxTransactions.filter(row => row.businessDate === dayDate && row.status !== 'voided'),
      openingCashBalance: operationalDay?.openingCashBalance,
    })
  }, [freshSettlementPreview, operationalDay, cashboxTransactions, ledgerVersion])

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

  const ensureStaffAuth = useCallback(async () => {
    if (canManageStaff(centralAuth()?.currentUser)) return true
    if (staffAuthInFlight.current) return staffAuthInFlight.current
    const task = (async () => {
      setStaffAuthBusy(true)
      setStaffAuthError('')
      try {
        const user = centralAuth()?.currentUser || await ensureKioskFirebaseSession()
        const record = await refreshCentralAuthorizationRecord(user)
        setCentralAuthUser(user)
        setStaffAuthorizationRecord(record)
        if (!record) {
          setStaffAuthError(`AUTHORIZED_RECORD = MISSING\nUID = ${user?.uid || '—'}\nEMAIL = ${user?.email || '—'}`)
          return false
        }
        if (!canManageStaff(user, record)) {
          setStaffAuthError(`AUTHORIZED_RECORD = NOT AUTHORIZED\nUID = ${user?.uid || '—'}\nEMAIL = ${user?.email || '—'}`)
          return false
        }
        return true
      } catch (error) {
        setStaffAuthError(error?.message || 'تعذر تسجيل الدخول بحساب POS.')
        return false
      } finally {
        setStaffAuthBusy(false)
      }
    })()
    staffAuthInFlight.current = task
    try { return await task } finally { staffAuthInFlight.current = null }
  }, [])

  const logoutAdmin = useCallback(async () => {
    setAdminAuthError('')
    await signOutCentral()
  }, [])

  const onCentralSyncStart = useCallback(() => {
    setSyncBusy(true)
    setSyncLabel(isCentralAdminUser(centralAuth()?.currentUser) ? 'جاري تحديث المبيعات...' : 'جاري المزامنة...')
  }, [])

  const onCentralSyncSuccess = useCallback(({ role, result }) => {
    setSyncBusy(false)
    const user = centralAuth()?.currentUser
    const providerId = user?.providerData?.[0]?.providerId || 'google.com'
    setSyncLabel('تمت المزامنة')
    setSyncAuthStatus({ ok: true, uid: user?.uid, email: user?.email, providerId, uploaded: result.uploaded, centralCount: result.centralCount, expenseUploaded: result.expenseUploaded, expenseCentralCount: result.expenseCentralCount })
  }, [])

  const onCentralSyncError = useCallback(error => {
    setSyncBusy(false)
    setSyncLabel(navigator.onLine === false ? 'محلي - بانتظار الاتصال' : isCentralAdminUser(centralAuth()?.currentUser) ? 'تحديث المبيعات' : 'المزامنة جاهزة')
    setSyncAuthStatus({ ok: false, message: error?.message || 'تعذر تنفيذ المزامنة.' })
  }, [])

  const handleCentralSyncClick = useMemo(() => createCentralSyncClickHandler({
    getCurrentUser: () => centralAuth()?.currentUser,
    signIn: ensureKioskFirebaseSession,
    runAdminRefresh: runAdminCentralRefresh,
    runCashierSync: async () => {
      const salesResult = await runCashierCentralSyncNow()
      const expenseResult = await runExpenseCentralSync({ initial: true })
      return {
        ...salesResult,
        expenseUploaded: expenseResult.uploaded,
        expenseSkipped: expenseResult.skipped,
        expenseCentralCount: expenseResult.centralCount,
      }
    },
    onStart: onCentralSyncStart,
    onSuccess: onCentralSyncSuccess,
    onError: onCentralSyncError,
  }), [onCentralSyncStart, onCentralSyncSuccess, onCentralSyncError])

  useEffect(() => {
    recoverStaleEmergencyRepairFlag()
    const retry = async () => {
      recoverStaleSyncLock()
      if (!(await canSyncPosSales(centralAuth()?.currentUser)).allowed) return null
      const sync = getCentralSyncState().initialSyncCompleted
        ? runCashierCentralSync()
        : runCashierCentralSync({ initial: true })
      void sync.catch(error => console.error('SALES_RETRY_SYNC_ERROR', error))
      return sync
    }
    const worker = createCashierQueueWorker({
      processQueue: retry,
      hasEligibleQueue: () => canSyncPosSales(centralAuth()?.currentUser).then(permission => permission.allowed),
      onDiagnostic: payload => {
        window.__POS101_QUEUE_WORKER_STATUS__ = payload
        window.dispatchEvent(new CustomEvent('pos101-sync-worker-diagnostic', { detail: payload }))
      },
    })
    const stopWorker = worker.start({ events: ['pos101-sale-created', 'pos101-sale-updated', 'online', 'focus', 'auth-ready', 'firebase-reconnect'], target: window })
    const onVisibility = () => { if (!document.hidden) void worker.run() }
    document.addEventListener('visibilitychange', onVisibility)
    const reconnectStop = subscribeCentralReconnect(() => { window.dispatchEvent(new Event('firebase-reconnect')) })
    const onSaleCreated = () => { void runNewSaleSyncDiagnostic().catch(error => console.info('POS101_NEW_SALE_SYNC_DIAGNOSTIC_ERROR', error?.code || error?.message || String(error))) }
    window.addEventListener('pos101-sale-created', onSaleCreated)
    return () => { reconnectStop?.(); stopWorker(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pos101-sale-created', onSaleCreated) }
  }, [])

  // The auth callback and this worker effect are independent React effects.
  // Re-emit the gate after React has committed the authenticated user so a
  // cold tab cannot miss the one-shot auth-ready event during startup.
  useEffect(() => {
    if (centralAuthUser) void canSyncPosSales(centralAuthUser).then(permission => {
      if (permission.allowed) {
        window.dispatchEvent(new Event('auth-ready'))
        void runNewSaleSyncDiagnostic().catch(() => {})
      }
    })
  }, [centralAuthUser?.uid])

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
  const update = useCallback(fn => setOrders(v => v.map((o, i) => i === active ? recalculateDiscount(fn(o), discountPresets) : o)), [active, discountPresets])
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

  const printOpenOrder = useCallback(() => {
    if (!session || !activeOrder?.items?.length) return false
    const now = Date.now()
    const draftReceipt = {
      saleId: `draft:${activeOrder.id}:${now}`,
      id: `draft:${activeOrder.id}:${now}`,
      createdAt: now,
      subtotal,
      discount: activeDiscount,
      total,
      seller: session.name || session.shiftName || '',
      cashierNameSnapshot: session.name || session.shiftName || '',
      items: activeOrder.items.map(item => ({ ...item })),
      order: {
        ...activeOrder,
        items: activeOrder.items.map(item => ({ ...item })),
      },
      draftReceipt: true,
    }
    void requestSalePrint(draftReceipt, { reprint: true })
    return true
  }, [session, activeOrder, subtotal, activeDiscount, total, requestSalePrint])

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

    let currentOperationalDay = operationalDay || readLocalOperationalDay()
    try {
      currentOperationalDay = await readOpenOperationalDay()
    } catch {
      currentOperationalDay = operationalDay || readLocalOperationalDay()
    }
    if (!currentOperationalDay || currentOperationalDay.status !== 'open') {
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
    let centralOrder
    try {
      centralOrder = await allocateCentralOrderNumber({ operationalDayId: currentOperationalDay.id, businessDate: currentOperationalDay.businessDate })
    } catch (error) {
      saleInFlight.current = false
      setOperationalDayError(error?.message || 'تعذر تخصيص رقم طلب مركزي. تحقق من الاتصال والمصادقة ثم أعد المحاولة.')
      setModal('operational-day-required')
      return false
    }

    const sale = {
      saleId: stableSaleId,
      id: stableSaleId,
      operationKey: stableOperationKey,
      orderNumber: centralOrder.orderNumber,
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
    setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
    if (autoPrint) void requestSalePrint(sale)
    setPendingPayment(null)
    window.setTimeout(() => setModal(null), 350)

    // 2. Persist the local ledger and deferred queue. No Firebase, ACC, Auth,
    // or Cloud Function call is allowed on this cashier-critical path.
    enqueueSale(sale)
    window.setTimeout(() => { saleInFlight.current = false }, 350)
    return true
  }, [session, activeOrder, subtotal, total, activeDiscount, active, autoPrint, pendingPayment, requestSalePrint, operationalDay])

  // Keyboard shortcuts and custom events
  useEffect(() => {
    const key = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'Escape') { setModal(null); return }
      if (!session) return

      // F5: Print the current open order only. It does not sell, save, clear,
      // renumber, or enqueue the order.
      if (e.key === 'F5') {
        e.preventDefault()
        if (activeOrder.items.length) printOpenOrder()
        return
      }

      // F6: Direct Sell; it respects the cashier's automatic-print setting.
      if (e.key === 'F6') {
        e.preventDefault()
        if (activeOrder.items.length && modal !== 'seller-selection') {
          initiateComplete({ method: 'cash', received: total, change: 0 })
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
  }, [activeOrder.items.length, session, initiateComplete, total, requestSalePrint, printOpenOrder])

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
    clearFinancialPinUnlock()
    setSession(null); setModal(null)
  }, [session])
  const clearCart = useCallback(() => update(o => ({ ...o, items: [], discount: null, table: null, orderType: null, held: false })), [update])
  const saveCurrentPendingTable = useCallback(async details => {
    if (!session || !activeOrder.items.length) return false
    const day = await readOpenOperationalDay()
    if (!day || day.status !== 'open') throw new Error('يجب بدء اليوم التشغيلي أولاً.')
    await savePendingTable({ ...details, items: activeOrder.items, subtotal, discount: activeDiscount, total, businessDate: day.businessDate, operationalDayId: day.id, cashierName: session.name || session.shiftName || '', cashierId: session.cashierId || session.shiftId || '', orderType: activeOrder.orderType })
    setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
    setModal(null)
    return true
  }, [session, activeOrder, subtotal, activeDiscount, total, active])
  const activateKiosk = useCallback(async code => {
    setKioskActivationBusy(true)
    setKioskActivationError('')
    try { await activateKioskWithCode(code) } catch (error) { setKioskActivationError(error?.message || 'تعذر تفعيل جهاز POS.') } finally { setKioskActivationBusy(false) }
  }, [])

  // The Google admin session is also the canonical staff-management session.
  // Use the hydrated current user here: adminAuthUser was captured before the
  // async authorization record loaded, so it could permanently miss admin-viewer.
  const adminReady = isCentralAdminUser(adminAuthUser) || isCentralAdminUser(centralAuthUser)
  const saveSaleEdit = useCallback((sale, changes) => changes?.itemCorrection ? correctCentralSaleItems(sale, changes) : updateCentralSale(sale, changes), [])
  const inspectBackup = useCallback(({ sales, syncQueueItems }) => inspectBackupSales({ sales, syncQueueItems }), [])
  const markBackupLocal = useCallback(({ sale, centralSale }) => markBackupSaleReadbackLocally({ sale, centralSale }), [])
  const recoverBackup = useCallback(payload => recoverBackupSale(payload), [])
  const repairBackup = useCallback(payload => runOneClickSyncRepair(payload), [])
  const productManagerReady = isCentralProductManager(productAuthUser)
  const staffManagerReady = canManageStaff(centralAuthUser, staffAuthorizationRecord)
  const backupRecoveryVisible = Boolean(session || adminReady || staffManagerReady)
  const backupRecoveryCanWrite = adminReady && BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED
  const requestView = useCallback(view => {
    const protectedView = view === 'expenses' || view === 'reports' ? view : null
    const leavingProtectedView = (currentView === 'expenses' || currentView === 'reports') && currentView !== view
    if (leavingProtectedView) clearFinancialPinUnlock()
    if (protectedView && !adminReady && !isFinancialPinUnlocked(protectedView)) {
      setFinancialPinTarget(view)
      setModal('financial-pin')
      return
    }
    setCurrentView(view)
  }, [adminReady, currentView])
  const unlockFinancialView = useCallback(async ({ staffId, pin }) => {
    const cashier = staff.find(row => String(row.id) === String(staffId))
    if (!cashier || !await verifyCashierPin(pin, cashier)) return false
    const target = financialPinTarget || 'reports'
    saveFinancialPinUnlock(target)
    setFinancialPinTarget(null)
    setModal(null)
    setCurrentView(target)
    return true
  }, [financialPinTarget, staff])
  const savePin = useCallback(async payload => {
    const saved = await saveCashierPin(payload)
    setStaff(current => current.map(row => String(row.id) === String(saved.id) ? saved : row))
    return saved
  }, [])
  const saveProduct = useCallback(async product => {
    const saved = await saveCentralProduct(product)
    setCentralProducts(current => [...current.filter(item => String(item.id) !== String(saved.id)), saved])
    return saved
  }, [])

  const kioskAuthReady = Boolean(centralAuthUser && isKioskAuthenticatedUser(centralAuthUser))
  if (isCentralConfigured() && !centralAuthReady) return null
  if (isCentralConfigured() && !kioskAuthReady) return <KioskActivation onActivate={activateKiosk} busy={kioskActivationBusy} error={kioskActivationError} />

  return (
    <main className={`app-shell ${currentView === 'settings' ? 'settings-app-shell' : ''} ${currentView === 'cashbox' ? 'cashbox-app-shell' : ''} ${currentView === 'employees' ? 'employees-app-shell' : ''} ${currentView === 'reports' || currentView === 'reports-captain' ? 'reports-app-shell' : ''} ${currentView === 'backup-recovery' ? 'backup-recovery-app-shell' : ''}`}>
      {versionStatus === 'updating' && <div className="pos101-update-status" role="status" aria-live="polite">جاري تحديث النظام...</div>}
      {(versionStatus === 'deferred' || versionStatus === 'pending') && versionBlocked && <div className="pos101-update-notice" role="status" aria-live="polite">يتوفر تحديث للنظام وسيتم تطبيقه بعد إكمال الطلب الحالي.</div>}
      {session && (
        <Header
          session={session}
          onOpenOrders={() => setModal('openOrders')}
          onCashierMenu={() => setModal('cashier-menu')}
          onLogout={logout}
          openOrdersCount={openOrdersCount}
          onDownloadSalesBackup={downloadSalesBackup}
          onSync={handleCentralSyncClick}
          syncBusy={syncBusy}
          syncLabel={syncLabel}
          currentView={currentView}
          onNavigate={requestView}
        />
      )}

      {currentView === 'dashboard' && (session || adminReady || staffManagerReady) && (
        <Dashboard onNavigate={requestView} onLogout={logout} canAccessBackupRecovery={backupRecoveryVisible} operationalDayEnabled={Boolean(session || adminReady)} operationalDay={operationalDay} operationalDaySummary={operationalDaySummary} settlementPreview={settlementPreview} preCloseGuard={preCloseGuard} pendingTableCount={pendingTables.filter(row => row.status === 'open').length} onPrepareEnd={prepareEndOperationalDay} onPrepareStart={prepareStartOperationalDay} operationalDayLoading={operationalDayLoading} operationalDayError={operationalDayError} onStartOperationalDay={handleStartOperationalDay} onSetOpeningCashBalance={handleSetOpeningCashBalance} onEndOperationalDay={handleEndOperationalDay} onReadDiagnostic={readDiagnostic} />
      )}

      {currentView === 'settings' && (session || adminReady || staffManagerReady) && (
        <Settings products={catalogProducts} categories={catalogCategories} canWrite={productManagerReady} canManageStaff={staffManagerReady} canAccessBackupRecovery={backupRecoveryVisible} onStaffSignIn={ensureStaffAuth} staffAuthBusy={staffAuthBusy} staffAuthError={staffAuthError} onSave={saveProduct} onNavigate={requestView} discountPresets={discountPresets} onSaveDiscountPresets={setDiscountPresets} staff={staff} onSaveStaff={saveCentralStaff} />
      )}
      {currentView === 'employees' && (session || adminReady || staffManagerReady) && <Employees staff={staff} canWrite={staffManagerReady} onStaffSignIn={ensureStaffAuth} staffAuthBusy={staffAuthBusy} staffAuthError={staffAuthError} onSaveStaff={saveCentralStaff} onSaveStaffPin={savePin} onNavigate={requestView} />}
      {currentView === 'cashbox' && (session || adminReady) && <FinancialCenter transactions={cashboxTransactions} centralSales={centralSales} operationalDays={centralOperationalDays} operationalDay={operationalDay} settlements={settlements} settlementCorrections={settlementCorrections} onSaveSettlementCorrection={saveSettlementCorrection} onSaveTransaction={saveCashboxTransaction} onUpdateTransaction={updateCashboxTransaction} onVoidTransaction={voidCashboxTransaction} onSaveCashCount={saveCashCount} onNavigate={setCurrentView} />}

      {currentView === 'orders' && (session || adminReady) && (
        <OrderHistoryMenu
          session={session}
          salesOverride={adminReady ? adminCentralSales : null}
          readOnly={false}
          onEditSale={saveSaleEdit}
          canCorrectSaleItems
          staff={staff}
          correctionActor={centralAuthUser || adminAuthUser}
          correctionAuthorization={staffAuthorizationRecord}
          onClose={() => setCurrentView('dashboard')}
        />
      )}
      {currentView === 'pending-tables' && (session || adminReady) && <PendingTables tables={pendingTables} session={session} onClose={() => setCurrentView('dashboard')} onPay={payPendingTable} onEdit={updatePendingTable} onTransition={transitionPendingTable} />}

      {currentView === 'pos' && session && (
        <div className="pos-body">
          <OrderPanel
            order={activeOrder}
            updateQuantity={updateQuantity}
            removeItem={removeItem}
            onEdit={i => (setSelected(i), setModal('options'))}
            onContinue={() => setModal('orderType')}
            onSavePending={() => setModal('save-pending-table')}
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
          {modal === 'history' && <OrderHistoryMenu session={session} onEditSale={saveSaleEdit} canCorrectSaleItems staff={staff} correctionActor={centralAuthUser || adminAuthUser} correctionAuthorization={staffAuthorizationRecord} onClose={() => setModal(null)} />}
        </div>
      )}

      {currentView === 'reports' && (session || adminReady) && (
        <Reports
          session={session || { name: 'الإدارة', status: 'admin-readonly' }}
          operationalDay={operationalDay}
          centralSales={centralSales}
          operationalDays={centralOperationalDays}
          settlements={settlements}
           settlementCorrections={settlementCorrections}
          cashboxTransactions={cashboxTransactions}
          staff={staff}
          salesOverride={adminReady ? adminCentralSales : null}
          products={catalogProducts}
          categories={catalogCategories}
          onNavigate={requestView}
          onDirectThermalPrint={session ? printReportDirect : undefined}
          directThermalReady={Boolean(session && directThermalReady)}
        />
      )}
      {currentView === 'expenses' && session && (
        <Expenses session={session} operationalDay={operationalDay} staff={staff} onNavigate={requestView} />
      )}
      {currentView === 'purchases' && session && <Purchases session={session} operationalDay={operationalDay} onNavigate={setCurrentView} />}
      {currentView === 'expense-entry' && session && (
        <Expenses session={session} operationalDay={operationalDay} staff={staff} onNavigate={requestView} />
      )}
      {currentView === 'reports-captain' && session && <Reports session={session} operationalDay={operationalDay} centralSales={centralSales} operationalDays={centralOperationalDays} settlements={settlements} cashboxTransactions={cashboxTransactions} staff={staff} products={catalogProducts} categories={catalogCategories} initialReportType="captain" onNavigate={requestView} />}

      {currentView === 'backup-recovery' && (
        <section className="settings-page backup-recovery-route" dir="rtl">
          <div className="settings-heading"><div><button type="button" className="back-link" onClick={() => setCurrentView('dashboard')}><Icon name="arrow" size={18} /> الرئيسية</button><h1>فحص واسترداد نسخة المبيعات</h1><p>{TEMP_OPEN_ONE_BUTTON_REPAIR ? 'ارفع ملف JSON واضغط إصلاح المزامنة تلقائيًا.' : 'فحص Firebase أولاً واسترداد فردي فقط بعد التحقق والموافقة.'}</p></div><span className="settings-lock">{TEMP_OPEN_ONE_BUTTON_REPAIR ? 'إصلاح تلقائي' : 'فحص آمن فقط'}</span></div>
          <SalesBackupRecovery adminUser={adminAuthUser || centralAuthUser} canReadback={adminReady} canRecover={backupRecoveryCanWrite} canRepair={TEMP_OPEN_ONE_BUTTON_REPAIR || adminReady} onInspect={inspectBackup} onMarkLocal={markBackupLocal} onRecover={recoverBackup} onRepair={repairBackup} />
        </section>
      )}

      {adminReady && !session && currentView === 'dashboard' && (
        <section className="admin-central-readonly" dir="rtl" aria-label="مركز مبيعات الإدارة">
          <header className="admin-central-head">
            <div><h1>الإدارة متصلة</h1><p>قراءة مركزية مباشرة — {adminCentralSales.length} مبيعات فريدة</p></div>
            <button className="secondary-action" type="button" onClick={logoutAdmin}>تسجيل خروج الإدارة</button>
          </header>
          <div className="admin-central-actions"><span>وضع الإدارة: قراءة فقط · الرفع محظور</span></div>
          <div className="admin-central-table-wrap"><table className="history-table"><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>الكاشير</th><th>الدفع</th><th>الإجمالي</th></tr></thead><tbody>{adminCentralSales.slice().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).map(sale => <tr key={sale.saleId}><td>{sale.orderNumber || '—'}</td><td>{new Date(sale.createdAt).toLocaleString('ar-IQ')}</td><td>{sale.cashierNameSnapshot || sale.seller || '—'}</td><td>{sale.paymentMethod || sale.payment?.method || '—'}</td><td>{formatNumber(sale.total || 0)}</td></tr>)}</tbody></table></div>
          <Reports session={{ name: 'الإدارة', status: 'admin-readonly' }} operationalDay={operationalDay} cashboxTransactions={cashboxTransactions} staff={staff} salesOverride={adminCentralSales} products={catalogProducts} categories={catalogCategories} onNavigate={() => {}} />
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
      {modal === 'financial-pin' && <FinancialPinDialog staff={staff} onClose={() => { setFinancialPinTarget(null); setModal(null) }} onUnlock={unlockFinancialView} />}
      {modal === 'operational-day-required' && <div className="overlay"><div className="dialog operational-day-required-dialog" dir="rtl"><h2>{operationalDayError ? 'تعذر إكمال البيع' : 'يجب بدء اليوم التشغيلي أولاً'}</h2><p>{operationalDayError || 'لن يتم إكمال البيع أو مسح السلة قبل بدء يوم تشغيلي مركزي.'}</p><div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => { setModal(null); setOperationalDayError('') }}>رجوع</button><button type="button" className="primary-action" onClick={() => { setModal(null); setOperationalDayError(''); setCurrentView('dashboard') }}>الانتقال إلى بدء اليوم</button></div></div></div>}
      {modal === 'confirm-clear' && <ConfirmDialog title="تفريغ سلة المشتريات" message="سيتم مسح العناصر الحالية ولا يمكن التراجع عن العملية." onClose={() => setModal(null)} onConfirm={() => { clearCart(); setModal(null) }} />}
      {modal === 'save-pending-table' && <SavePendingTableDialog total={total} session={session} onClose={() => setModal(null)} onSave={saveCurrentPendingTable} />}
      {modal === 'print-menu' && <PrintMenu enabled={autoPrint} settings={printerSettings} thermalStatus={thermalStatus} onClose={() => setModal(null)} onChange={v => setAutoPrint(v)} onSave={savePrinterSettings} onCheck={settings => refreshThermalStatus({ ...printerSettings, ...settings })} onDirectChange={v => setPrinterSettings(s => ({ ...s, directThermal: v }))} />}
      {modal === 'options' && <ProductOptions product={selected} onClose={() => setModal(null)} onAdd={addProduct} />}
      {modal === 'variants' && selected && <VariantModal product={selected} variants={selected.variantProducts || []} onClose={() => setModal(null)} onSelect={child => selectVariant(selected, child)} />}
      {modal === 'orderType' && <OrderType onClose={() => setModal(null)} onChoose={chooseType} />}
      {modal === 'tables' && <TableSelection orders={orders} onClose={() => setModal(null)} onChoose={chooseTable} />}
      {modal === 'payment' && <Payment total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'quickCash' && <QuickCash total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'seller-selection' && <SellerSelection staff={staff} staffStatus={staffStatus} onClose={() => setModal(null)} onSelect={finalizeSale} />}
      {modal === 'discount' && <DiscountDialog subtotal={subtotal} current={activeOrder.discount} discountPresets={discountPresets} onClose={() => setModal(null)} onApply={applyDiscount} />}
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
            <span>{syncAuthStatus.message || 'تمت المزامنة'}{!syncAuthStatus.readOnly && Number.isFinite(syncAuthStatus.uploaded) ? ` — ${syncAuthStatus.uploaded} مبيعات جديدة` : ''}{!syncAuthStatus.readOnly && Number.isFinite(syncAuthStatus.expenseUploaded) ? ` — ${syncAuthStatus.expenseUploaded} مصاريف جديدة` : ''}</span>
          ) : (
            <span>{syncAuthStatus.message}</span>
          )}
          <button type="button" aria-label="إغلاق حالة تسجيل دخول المزامنة" onClick={() => setSyncAuthStatus(null)}>×</button>
        </div>
      )}
    </main>
  )
}
