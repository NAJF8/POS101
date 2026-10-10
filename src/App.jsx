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
import { categories, products, categoryId } from './data/menu'
import { Icon } from './components/Icons'
import { checkThermalService, defaultThermalSettings, printThermalDocument } from './services/thermalPrinter'
import { buildSalesBackup, enqueueVoidUpdate, markSaleVoidedCentral, resolveVoidedSaleLocally, readSaleSyncStatus, readHeaderPendingDiagnostic, getPendingOrderBadgeState, readPendingSaleDiagnostics } from './services/salesSyncQueue'
import { activateKioskWithCode, canManageStaff, canSyncPosSales, centralAuth, correctCentralSaleItems, ensureKioskFirebaseSession, getCentralSyncState, isCentralAdminUser, isCentralCashierUser, isCentralConfigured, isCentralProductManager, isKioskAuthenticatedUser, isOperationalDayClosedError, isOperationalDayUser, readCashierSaleSyncDiagnostics, readCashboxReadDiagnostics, recoverStaleEmergencyRepairFlag, recoverStaleSyncLock, refreshCentralAuthorizationRecord, readCachedOperationalDay, readCentralOperationalDay, readCentralOperationalDays, readCentralCashboxTransactions, readCentralSettlements, readCentralSettlementCorrections, readEndDayDiagnostic, readFreshSettlementPreview, readOpeningCashSuggestion, readLocalExpenses, readLocalOperationalDay, readPreCloseReconciliation, processSaleSyncQueue, runAdminCentralRefresh, runCashierCentralSync, runCashierCentralSyncNow, runExpenseCentralSync, runNewSaleSyncDiagnostic, saveCentralProduct, saveCashierPin, signInAdminWithGoogle, signOutCentral, subscribeCentralAuth, subscribeCentralReconnect, subscribeCentralExpenses, subscribeCentralProducts, subscribeCentralSales, subscribeCentralSalesReadOnly, subscribeOperationalDay, startOperationalDay, setOperationalDayOpeningCashBalance, settleAndEndOperationalDay, readOpenOperationalDay, subscribeCentralStaff, readCentralStaff, subscribeCentralCashboxTransactions, subscribeCentralSettlements, subscribeCentralSettlementCorrections, saveSettlementCorrection, saveCentralStaff, saveCashboxTransaction, updateCashboxTransaction, voidCashboxTransaction, saveCashCount, updateCentralSale, voidCentralSaleImmediately, subscribePendingTables, savePendingTable, updatePendingTable, payPendingTable, transitionPendingTable } from './services/posCentralSync.js'
import { createCentralSyncClickHandler } from './services/centralSyncController.js'
import { formatNumber } from './utils.js'
import { readCentralSalesForReports } from './services/posCentralSync.js'
import { getOpenOrders } from './services/orderState.js'
import { BUILD_SHA, VERSION_CHECK_INTERVAL_MS, createVersionController, installServiceWorker } from './services/versionUpdate.js'
import { readLocalSales } from './services/reportSales.js'
import { calculateOperationalDaySummary } from './services/operationalDayReport.js'
import { canonicalSalesForOperationalDay, reconcileCanonicalSales } from './services/canonicalSales.js'
import { calculateSettlement } from './services/financialCenter.js'
import KioskActivation from './components/KioskActivation.jsx'
import SalesBackupRecovery from './components/SalesBackupRecovery.jsx'
import PendingSaleStatusDialog from './components/PendingSaleStatusDialog.jsx'
import CentralPendingDiagnostics from './components/CentralPendingDiagnostics.jsx'
import { clearFinancialPinUnlock, isFinancialPinUnlocked, saveFinancialPinUnlock, verifyCashierPin } from './services/cashierPin.js'
import { createCashierQueueWorker } from './services/cashierQueueWorker.js'
import { buildCartItem, normalizeCartItems, normalizeOrder, safeNumber } from './services/cartItem.js'
import { buildRealOptionsAddTest, prepareCartAdd } from './services/cartPipeline.js'
import { writeSalesCache } from './services/localSalesCache.js'
import { BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED, TEMP_OPEN_ONE_BUTTON_REPAIR, inspectBackupSales, inspectPendingSaleCentralStatus, markBackupSaleReadbackLocally, readCentralPendingSaleDiagnostics, reconcileCentralPendingSaleDiagnostics, recoverBackupSale, runOneClickSyncRepair } from './services/posCentralSync.js'
import { recordSafeUiError, runSafeSystemCheck } from './services/safeSystemCheck.js'
import { saleEngine } from './services/saleEngine.js'

const blankOrder = index => ({ id: index, name: `طلب ${index}`, items: [], table: null, orderType: null, held: false, completed: false, adjustments: [] })
const ensureOrderSlots = (value, count = 10) => {
  const list = Array.isArray(value) ? value.filter(Boolean).map(normalizeOrder) : []
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
const orderSubtotal = order => normalizeCartItems(order?.items).reduce((sum, item) => sum + safeNumber(item.price * item.quantity, 0), 0)
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
  const normalized = normalizeOrder(order)
  if (!normalized.discount) return normalized
  return { ...normalized, discount: { ...normalized.discount, value: discountValue(orderSubtotal(normalized), normalized.discount, discountPresets) } }
}
const markRealClickDiagnostic = (stage, details = {}) => {
  if (typeof window === 'undefined') return
  const previous = window.__POS101_REAL_CLICK_DIAGNOSTIC__ || {}
  window.__POS101_REAL_CLICK_DIAGNOSTIC__ = { ...previous, stage, ...details, timestamp: new Date().toISOString() }
}
const shifts = [
  { shiftId: 'morning', shiftType: 'morning', shiftLabel: 'صباحي', name: 'كاشير صباحي' },
  { shiftId: 'evening', shiftType: 'evening', shiftLabel: 'مسائي', name: 'كاشير مسائي' }
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
  const [pendingPayment, setPendingPayment] = useState(null)
  const [safeCheckState, setSafeCheckState] = useState({ running: false, result: null, onClose: () => {} })
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
  const [saleSyncWarning, setSaleSyncWarning] = useState('')
  const [pendingSaleDialog, setPendingSaleDialog] = useState(null)
  const [pendingSaleActionBusy, setPendingSaleActionBusy] = useState(false)
  const [syncAuthStatus, setSyncAuthStatus] = useState(null)
  const [saleSyncStatus, setSaleSyncStatus] = useState(() => readSaleSyncStatus())
  const [cashierSyncPhase, setCashierSyncPhase] = useState('idle')
  const [cashierToast, setCashierToast] = useState('')
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
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
  const [centralPendingDiagnostics, setCentralPendingDiagnostics] = useState([])
  const [centralPendingDiagnosticsBusy, setCentralPendingDiagnosticsBusy] = useState(false)
  const [centralPendingDiagnosticsReport, setCentralPendingDiagnosticsReport] = useState(null)
  const [centralSales, setCentralSales] = useState([])
  const [pendingTables, setPendingTables] = useState([])
  const [centralOperationalDays, setCentralOperationalDays] = useState([])
  const centralListener = useRef(null)
  const productListener = useRef(null)
  const [centralProducts, setCentralProducts] = useState([])
  const [operationalDay, setOperationalDay] = useState(() => readCachedOperationalDay())
  const [operationalDayCentralReady, setOperationalDayCentralReady] = useState(() => !isCentralConfigured())
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
  const [cashboxDiagnostic, setCashboxDiagnostic] = useState(() => new URLSearchParams(window.location.search).has('cashbox-debug') ? { status: 'starting' } : null)
  const settlementCorrectionListener = useRef(null)
  const pendingTablesListener = useRef(null)
  const [settlementCorrections, setSettlementCorrections] = useState([])
  const saleInFlight = useRef(false)
  const lastSellerName = useRef('')
  const staffMigrationAttempted = useRef(false)
  const staffAuthInFlight = useRef(null)

  useEffect(() => {
    const online = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline) }
  }, [])

  useEffect(() => {
    if (!centralAuthUser?.uid) return undefined
    let active = true
    const bindReadOnlyCashboxState = async () => {
      const [salesResult, daysResult, transactionsResult, settlementsResult, correctionsResult] = await Promise.allSettled([
        readCentralSalesForReports(),
        readCentralOperationalDays(),
        readCentralCashboxTransactions(),
        readCentralSettlements(),
        readCentralSettlementCorrections(),
      ])
      if (!active) return
      const pipeline = {
        rawSalesCount: salesResult.status === 'fulfilled' ? salesResult.value.length : null,
        normalizedSalesCount: salesResult.status === 'fulfilled' ? salesResult.value.length : null,
        operationalDaysCount: daysResult.status === 'fulfilled' ? daysResult.value.length : null,
        transactionsCount: transactionsResult.status === 'fulfilled' ? transactionsResult.value.length : null,
        settlementsCount: settlementsResult.status === 'fulfilled' ? settlementsResult.value.length : null,
        correctionsCount: correctionsResult.status === 'fulfilled' ? correctionsResult.value.length : null,
        errors: [salesResult, daysResult, transactionsResult, settlementsResult, correctionsResult]
          .map(result => result.status === 'rejected' ? result.reason?.code || result.reason?.message || 'READ_FAILED' : null)
          .filter(Boolean),
      }
      window.__POS101_CASHBOX_PIPELINE = pipeline
      setCashboxDiagnostic(previous => previous ? { ...previous, pipeline } : previous)
      if (salesResult.status === 'fulfilled') setCentralSales(salesResult.value)
      else console.error('CENTRAL_SALES_STATE_BINDING_ERROR', salesResult.reason)
      if (daysResult.status === 'fulfilled') setCentralOperationalDays(Array.isArray(daysResult.value) ? daysResult.value : [])
      else console.error('CENTRAL_OPERATIONAL_DAYS_STATE_BINDING_ERROR', daysResult.reason)
      if (transactionsResult.status === 'fulfilled') setCashboxTransactions(Array.isArray(transactionsResult.value) ? transactionsResult.value : [])
      else console.error('CENTRAL_TRANSACTIONS_STATE_BINDING_ERROR', transactionsResult.reason)
      if (settlementsResult.status === 'fulfilled') setSettlements(Array.isArray(settlementsResult.value) ? settlementsResult.value : [])
      else console.error('CENTRAL_SETTLEMENTS_STATE_BINDING_ERROR', settlementsResult.reason)
      if (correctionsResult.status === 'fulfilled') setSettlementCorrections(Array.isArray(correctionsResult.value) ? correctionsResult.value : [])
      else console.error('CENTRAL_CORRECTIONS_STATE_BINDING_ERROR', correctionsResult.reason)
    }
    void bindReadOnlyCashboxState()
    const retry = window.setTimeout(() => { void bindReadOnlyCashboxState() }, 1500)
    return () => { active = false; window.clearTimeout(retry) }
  }, [centralAuthUser?.uid])

  useEffect(() => {
    const showToast = event => {
      setCashierToast(String(event.detail || ''))
      window.setTimeout(() => setCashierToast(''), 2200)
    }
    window.addEventListener('pos101-cashier-toast', showToast)
    return () => window.removeEventListener('pos101-cashier-toast', showToast)
  }, [])

  const downloadSalesBackup = useCallback(() => {
    const backup = {
      ...buildSalesBackup(),
      operationalDay: operationalDay || readLocalOperationalDay() || null,
      appVersion: BUILD_SHA,
      liveBundle: Array.from(document.scripts).find(script => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(script.src))?.src || null,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `pos101-sales-backup-${backup.createdAt.replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [operationalDay])


  const activeOrder = normalizeOrder(orders[active] || orders[0] || blankOrder(1))
  const subtotal = orderSubtotal(activeOrder)
  const activeDiscount = discountValue(subtotal, activeOrder.discount, discountPresets)
  const total = Math.max(0, subtotal - activeDiscount)

  const runSafeCheck = useCallback(async () => {
    setSafeCheckState(previous => ({ ...previous, running: true, result: null }))
    try {
      const safeProducts = [...new Map([...products, ...centralProducts].map(product => [String(product?.id), product])).values()]
      const result = await runSafeSystemCheck({
        session,
        operationalDay,
        activeOrder,
        orders,
        active,
        centralProducts,
        products: safeProducts,
        centralSales,
        adminDiagnostics: Boolean((adminAuthUser && isCentralAdminUser(adminAuthUser)) || (centralAuthUser && isCentralAdminUser(centralAuthUser))),
        pendingPayment,
        modal,
        saleInFlight,
        onRepairOrder: () => setOrders(current => current.map((order, index) => index === active ? recalculateDiscount(normalizeOrder(order), discountPresets) : normalizeOrder(order))),
        onRepairDay: day => { setOperationalDay(day); setOperationalDayCentralReady(day?.status === 'open') },
        onRepairPayment: () => { setPendingPayment(null); setModal(null) },
        buildCartItemFn: buildCartItem,
        normalizeOrderFn: normalizeOrder,
        prepareCartAddFn: prepareCartAdd,
        calculateTotalsFn: order => {
          const subtotalValue = orderSubtotal(order)
          const discountValueForOrder = discountValue(subtotalValue, order?.discount, discountPresets)
          return { subtotal: subtotalValue, discount: discountValueForOrder, total: Math.max(0, subtotalValue - discountValueForOrder) }
        },
        paymentSummaryFn: totals => ({ total: totals.total, label: `${formatNumber(totals.total)} د.ع` }),
      })
      setSafeCheckState({ running: false, result, onClose: () => setSafeCheckState(state => ({ ...state, result: null })) })
    } catch (error) {
      setSafeCheckState({ running: false, result: { status: 'fail', checks: [{ name: 'safe-check', status: 'fail', message: error?.message || 'تعذر الفحص' }], warnings: [], errors: [error?.message || 'SAFE_CHECK_FAILED'] }, onClose: () => setSafeCheckState(state => ({ ...state, result: null })) })
    }
  }, [session, operationalDay, activeOrder, orders, active, centralProducts, centralSales, pendingPayment, modal, discountPresets, adminAuthUser, centralAuthUser])

  const checkPendingSale = useCallback(async () => {
    if (pendingSaleActionBusy) return
    setPendingSaleActionBusy(true)
    try {
      const result = await inspectPendingSaleCentralStatus({ reconcile: true })
      const entries = readPendingSaleDiagnostics().filter(row => row.type === 'sale_write')
      setPendingSaleDialog({ entries, check: result })
      if (result.reconciled > 0 && result.remaining === 0) {
        setSaleSyncWarning('الطلب موجود مركزيًا وتمت تسوية الحالة المحلية')
        setCashierSyncPhase('saved')
      }
    } catch (error) {
      setPendingSaleDialog({ entries: readPendingSaleDiagnostics().filter(row => row.type === 'sale_write'), check: { firebaseRead: 'FAIL', error: error?.message || String(error) } })
    } finally {
      setPendingSaleActionBusy(false)
    }
  }, [pendingSaleActionBusy])

  const retryPendingSale = useCallback(async () => {
    if (pendingSaleActionBusy) return
    setPendingSaleActionBusy(true)
    try {
      // The read is mandatory. The queue worker performs the same central
      // identity/readback guards before any write when the sale is missing.
      const before = await inspectPendingSaleCentralStatus({ reconcile: true })
      if (before.firebaseRead === 'FAIL') throw Object.assign(new Error(before.error || 'تعذر فحص Firebase قبل إعادة الرفع.'), { code: before.errorCode || 'PENDING_READ_FAILED' })
      if (before.duplicateFound) {
        setPendingSaleDialog({ entries: readPendingSaleDiagnostics().filter(row => row.type === 'sale_write'), check: before })
        return
      }
      if (before.remaining > 0) await runCashierCentralSyncNow()
      const after = await inspectPendingSaleCentralStatus({ reconcile: true })
      const entries = readPendingSaleDiagnostics().filter(row => row.type === 'sale_write')
      setPendingSaleDialog({ entries, check: entries.length ? after : { ...after, status: 'RESOLVED', reconciled: after.reconciled || 1, remaining: 0 } })
      if (!entries.length) {
        setSaleSyncWarning('تم رفع الطلب مركزيًا')
        setCashierSyncPhase('saved')
      }
    } catch (error) {
      setPendingSaleDialog({ entries: readPendingSaleDiagnostics().filter(row => row.type === 'sale_write'), check: { firebaseRead: 'FAIL', error: error?.message || String(error), errorCode: error?.code || 'RETRY_FAILED' } })
    } finally {
      setPendingSaleActionBusy(false)
    }
  }, [pendingSaleActionBusy])

  const refreshCentralPendingDiagnostics = useCallback(async ({ reconcile = false } = {}) => {
    setCentralPendingDiagnosticsBusy(true)
    try {
      const report = reconcile ? await reconcileCentralPendingSaleDiagnostics() : null
      const rows = await readCentralPendingSaleDiagnostics()
      setCentralPendingDiagnostics(rows)
      setCentralPendingDiagnosticsReport(report || { firebaseRead: 'PASS', results: [], resolved: 0, missing: 0, duplicates: 0, salesCreated: 0, salesDeleted: 0 })
      return { report, rows }
    } catch (error) {
      setCentralPendingDiagnosticsReport({ firebaseRead: 'FAIL', error: error?.message || String(error), results: [] })
      throw error
    } finally { setCentralPendingDiagnosticsBusy(false) }
  }, [])

  const runRealOptionsAddTest = useCallback(() => {
    const safeProducts = [...new Map([...products, ...centralProducts].map(product => [String(product?.id), product])).values()]
    const optionProduct = safeProducts.find(product => ['ايس لاتيه بنكهات', 'لاتيه بنكهات'].some(label => String(product?.name || '').includes(label))) || safeProducts.find(product => product?.configurable)
    const realClickTest = optionProduct
      ? buildRealOptionsAddTest({ activeOrder, product: optionProduct, buildCartItemFn: buildCartItem, normalizeOrderFn: normalizeOrder })
      : { ok: false, error: 'SAFE_REAL_OPTIONS_PRODUCT_NOT_FOUND', stage: 'product', mode: 'no-save', stateMutation: 'SKIPPED', firebaseWrites: 0, localStorageWrites: 0, modalClose: 'SKIPPED' }
    if (!realClickTest.ok) recordSafeUiError('SAFE_REAL_OPTIONS_ADD_TEST', new Error(realClickTest.error), { stage: realClickTest.stage })
    setSafeCheckState(previous => ({ ...previous, result: previous.result ? { ...previous.result, realClickTest } : { status: realClickTest.ok ? 'pass' : 'fail', realClickTest } }))
    return realClickTest
  }, [activeOrder, centralProducts])

  const openOrdersCount = getOpenOrders(orders).length

  const headerPendingDiagnostic = useMemo(() => {
    const diagnostic = readHeaderPendingDiagnostic({ orders, openOrderCount: openOrdersCount, operationalDay })
    const badge = getPendingOrderBadgeState(diagnostic, { sourceComponent: 'Header.jsx:sync-status-chip' })
    return { ...diagnostic, badgeShow: badge.show, badgeReason: badge.reason, badgeSourceComponent: badge.sourceComponent, badgeBlockers: badge.blockers }
  }, [orders, openOrdersCount, operationalDay?.id, operationalDay?.businessDate, saleSyncStatus])

  useEffect(() => {
    window.__POS101_HEADER_PENDING_DIAGNOSTIC__ = headerPendingDiagnostic
    console.info('HEADER_PENDING_DIAGNOSTIC', headerPendingDiagnostic)
  }, [headerPendingDiagnostic])

  useEffect(() => {
    if (!headerPendingDiagnostic.badgeShow && cashierSyncPhase === 'pending') setCashierSyncPhase('idle')
  }, [headerPendingDiagnostic.badgeShow, cashierSyncPhase])

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
  useEffect(() => {
    try {
      localStorage.setItem('pos101.orders', JSON.stringify(orders.map(normalizeOrder)))
      const diagnostic = window.__POS101_REAL_CLICK_DIAGNOSTIC__
      if (diagnostic?.pendingLocalStorageSave) {
        markRealClickDiagnostic('localStorage_save_reached', { REAL_LOCALSTORAGE_SAVE_REACHED: 'YES', pendingLocalStorageSave: false })
      }
    } catch (error) {
      if (window.__POS101_REAL_CLICK_DIAGNOSTIC__?.pendingLocalStorageSave) {
        markRealClickDiagnostic('localStorage_save_error', { REAL_LOCALSTORAGE_SAVE_REACHED: 'NO', REAL_ERROR_STAGE: 'LOCALSTORAGE_SAVE' })
        recordSafeUiError('REAL_OPTIONS_ADD_LOCALSTORAGE', error)
      }
    }
  }, [orders])
  useEffect(() => localStorage.setItem('pos101.session', JSON.stringify(session)), [session])
  useEffect(() => localStorage.setItem('pos101.autoPrint', JSON.stringify(autoPrint)), [autoPrint])
  useEffect(() => localStorage.setItem('pos101.discountPresets', JSON.stringify(discountPresets)), [discountPresets])
  useEffect(() => localStorage.setItem('pos101.printerSettings', JSON.stringify(printerSettings)), [printerSettings])
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
      setOperationalDayCentralReady(!user || !isOperationalDayUser(user) ? false : false)
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
      if (user) {
        // Cashbox is a read path for every authorized POS user; its Firebase
        // listeners enforce read authorization and never broaden write access.
        cashboxListener.current = subscribeCentralCashboxTransactions(setCashboxTransactions)
        settlementListener.current = subscribeCentralSettlements(setSettlements)
        settlementCorrectionListener.current = subscribeCentralSettlementCorrections(setSettlementCorrections)
      }
      if (isCentralAdminUser(user) || isCentralCashierUser(user)) {
        operationalDayListener.current = subscribeOperationalDay(day => { setOperationalDayCentralReady(true); setOperationalDay(day) })
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
       if (!user) return
       void readCentralSalesForReports().then(rows => {
         if (centralAuth()?.currentUser?.uid === user.uid) setCentralSales(rows)
       }).catch(error => console.error('CENTRAL_SALES_REPORT_READ_ERROR', error))
       centralListener.current = subscribeCentralSales(({ centralSales: receivedSales, centralCount, mergedSales }) => {
         if (receivedSales) setCentralSales(receivedSales)
         if (mergedSales) setAdminCentralSales(mergedSales)
        setSyncAuthStatus(current => current?.ok ? { ...current, centralCount } : current)
      }, user)
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
    if (!new URLSearchParams(window.location.search).has('cashbox-debug')) return undefined
    let active = true
    let timeout
    const maskUid = uid => {
      const value = String(uid || '')
      return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value ? 'present' : ''
    }
    const publish = value => {
      if (!active) return
      setCashboxDiagnostic(previous => ({
        ...value,
        ...(previous?.pipeline ? { pipeline: previous.pipeline } : {}),
        ...(previous?.stateCounts ? { stateCounts: previous.stateCounts } : {}),
      }))
      window.__POS101_CASHBOX_DIAGNOSTIC = value
    }
    const finish = value => { window.clearTimeout(timeout); publish(value) }
    timeout = window.setTimeout(() => finish({ status: 'timeout', reason: 'Cashbox Firebase diagnostic exceeded 12 seconds.' }), 12000)
    void (async () => {
      try {
        publish({ status: 'auth_wait' })
        let user = centralAuth()?.currentUser || null
        for (let attempt = 0; !user && attempt < 3; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 500))
          user = centralAuth()?.currentUser || null
        }
        if (!user) {
          finish({ status: 'auth_failed', authReady: false, uidMasked: '', authorized: false, error: 'AUTH_REQUIRED: Firebase auth.currentUser was not ready.' })
          return
        }
        publish({ status: 'auth_ready', authReady: true, uidMasked: maskUid(user.uid), emailAvailable: Boolean(user.email) })
        publish({ status: 'rules_read_test', authReady: true, uidMasked: maskUid(user.uid), emailAvailable: Boolean(user.email) })
        const result = await Promise.race([
          readCashboxReadDiagnostics(),
          new Promise(resolve => window.setTimeout(() => resolve({ status: 'timeout', authReady: true, uidMasked: maskUid(user.uid), error: 'READ_TEST_TIMEOUT' }), 8000)),
        ])
        if (!active) return
        if (result.status === 'timeout') { finish(result); return }
        const paths = result.paths || {}
        const readsOk = [paths.sales, paths.expenses, paths.operationalDays, paths.operationalCurrent, paths.settlements].every(row => row?.ok)
        finish({ ...result, status: readsOk ? 'success' : 'permission_denied' })
      } catch (error) {
        finish({ status: 'error', authReady: Boolean(centralAuth()?.currentUser), uidMasked: maskUid(centralAuth()?.currentUser?.uid), error: error?.message || 'CASHBOX_READ_DIAGNOSTIC_ERROR' })
      }
    })()
    return () => { active = false; window.clearTimeout(timeout) }
  }, [])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('cashbox-debug')) return
    const stateCounts = {
      centralSales: centralSales.length,
      centralOperationalDays: centralOperationalDays.length,
      cashboxTransactions: cashboxTransactions.length,
      settlements: settlements.length,
      settlementCorrections: settlementCorrections.length,
    }
    window.__POS101_CASHBOX_STATE_COUNTS = stateCounts
    setCashboxDiagnostic(previous => {
      if (!previous) return previous
      if (JSON.stringify(previous.stateCounts) === JSON.stringify(stateCounts)) return previous
      return { ...previous, stateCounts }
    })
  }, [centralSales.length, centralOperationalDays.length, cashboxTransactions.length, settlements.length, settlementCorrections.length])

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
    const refreshSaleSyncStatus = () => setSaleSyncStatus(readSaleSyncStatus())
    window.addEventListener('pos101-sale-created', refreshOperationalSummary)
    window.addEventListener('pos101-sale-updated', refreshOperationalSummary)
    window.addEventListener('pos101-expenses-updated', refreshOperationalSummary)
    window.addEventListener('pos101-sale-created', refreshSaleSyncStatus)
    window.addEventListener('pos101-sale-updated', refreshSaleSyncStatus)
    return () => {
      window.removeEventListener('pos101-sale-created', refreshOperationalSummary)
      window.removeEventListener('pos101-sale-updated', refreshOperationalSummary)
      window.removeEventListener('pos101-expenses-updated', refreshOperationalSummary)
      window.removeEventListener('pos101-sale-created', refreshSaleSyncStatus)
      window.removeEventListener('pos101-sale-updated', refreshSaleSyncStatus)
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
      const result = await settleAndEndOperationalDay(operationalDay, { actualCash, openOrderCount: openOrdersCount, endedBy: { name: session?.name || session?.shiftName || '' }, explicitUserAction: true, closeSource: 'manual_end_day', closeReason: 'manual-confirmed' })
      const reopened = await readOpenOperationalDay()
      setOperationalDay(result.day || reopened || { ...operationalDay, status: 'closed' })
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
    const pending = readPendingSaleDiagnostics().length
    const uploaded = Number(result?.uploaded || 0) + Number(result?.updated || 0)
    const failed = Math.max(0, Number(result?.skipped || 0))
    setSyncLabel(`تم رفع ${uploaded} طلب · فشل ${failed} طلب · المتبقي ${pending}`)
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

  const syncBeforeReportPrint = useCallback(async () => {
    const permission = await canSyncPosSales(centralAuth()?.currentUser)
    if (!permission.allowed) throw Object.assign(new Error('تسجيل الدخول مطلوب قبل طباعة التقرير المركزي.'), { code: 'CENTRAL_ROLE_BLOCKED' })
    await runCashierCentralSync()
  }, [])

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
      getDiagnosticContext: async () => {
        const user = centralAuth()?.currentUser
        const permission = await canSyncPosSales(user).catch(error => ({ allowed: false, error: error?.code || error?.message || String(error) }))
        return {
          queueSales: readPendingSaleDiagnostics(),
          canSync: Boolean(permission.allowed),
          authUser: user?.uid || user?.email || null,
          online: navigator.onLine !== false,
          lockState: window.localStorage.getItem('pos101.syncLock') || null,
          repairFlagState: window.localStorage.getItem('pos101.emergencyRepairActive') || null,
          permissionError: permission.error || null,
          permissionReason: permission.missingReason || null,
        }
      },
      onDiagnostic: payload => {
        window.__POS101_QUEUE_WORKER_STATUS__ = payload
        setPendingSaleDialog(current => {
          if (!current) return current
          const entries = readPendingSaleDiagnostics().filter(row => row.type === 'sale_write')
          return entries.length ? { ...current, entries } : { ...current, entries: [], check: { ...(current.check || {}), status: 'RESOLVED', remaining: 0, reconciled: 1 } }
        })
        window.dispatchEvent(new CustomEvent('pos101-sync-worker-diagnostic', { detail: payload }))
      },
    })
    const stopWorker = worker.start({ events: ['pos101-sale-created', 'pos101-sale-updated', 'online', 'focus', 'auth-ready', 'firebase-reconnect'], target: window })
    const onVisibility = () => { if (!document.hidden) void worker.run() }
    document.addEventListener('visibilitychange', onVisibility)
    const reconnectStop = subscribeCentralReconnect(() => { window.dispatchEvent(new Event('firebase-reconnect')) })
    const onSaleCreated = () => { void runNewSaleSyncDiagnostic().catch(error => console.info('POS101_NEW_SALE_SYNC_DIAGNOSTIC_ERROR', error?.code || error?.message || String(error))) }
    const onWorkerDiagnostic = () => {
      const status = readSaleSyncStatus()
      setSaleSyncStatus(status)
      if (!status.activePendingQueueCount && !status.unverifiedActiveSalesCount) {
        setSaleSyncWarning('')
        setCashierSyncPhase('idle')
      }
    }
    window.addEventListener('pos101-sale-created', onSaleCreated)
    window.addEventListener('pos101-sync-worker-diagnostic', onWorkerDiagnostic)
    return () => { reconnectStop?.(); stopWorker(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pos101-sale-created', onSaleCreated); window.removeEventListener('pos101-sync-worker-diagnostic', onWorkerDiagnostic) }
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

  const activeShift = Boolean(session?.shiftId && (session?.shiftType === 'morning' || session?.shiftType === 'evening'))

  // Order mutations
  const update = useCallback(fn => setOrders(v => v.map((o, i) => i === active ? recalculateDiscount(fn(normalizeOrder(o)), discountPresets) : normalizeOrder(o))), [active, discountPresets])
  const addProduct = useCallback(p => {
    window.__POS101_LAST_ACTION__ = 'ADD_TO_CART'
    window.__POS101_LAST_PRODUCT_CLICKED__ = { name: String(p?.name || p?.displayName || ''), id: String(p?.id || p?.productId || ''), timestamp: new Date().toISOString() }
    markRealClickDiagnostic('options_add_start', {
      REAL_CLICK_HANDLER_REACHED: 'YES', REAL_RAW_ITEM_CREATED: 'NO', REAL_NORMALIZED_ITEM_CREATED: 'NO', REAL_SET_ACTIVE_ORDER_CALLED: 'NO', REAL_MODAL_CLOSE_REACHED: 'NO', REAL_LOCALSTORAGE_SAVE_REACHED: 'NO', REAL_RENDER_AFTER_SETSTATE_REACHED: 'NO', REAL_ERROR_STAGE: 'NONE', pendingLocalStorageSave: false, pendingRenderAfterSetState: false,
      product: { name: String(p?.name || p?.displayName || ''), id: String(p?.id || p?.productId || ''), size: String(p?.size?.label || p?.size?.name || ''), options: Array.isArray(p?.options) ? p.options.length : 0, additions: Array.isArray(p?.additions) ? p.additions.length : 0, flavors: Array.isArray(p?.flavors) ? p.flavors.length : 0 },
      activeOrderBefore: { itemCount: activeOrder.items.length, id: String(activeOrder.id || '') },
    })
    try {
      const result = prepareCartAdd({ activeOrder, product: p, lineId: `${p?.id || 'product'}-${Date.now()}`, buildCartItemFn: buildCartItem, normalizeOrderFn: normalizeOrder })
      markRealClickDiagnostic('raw_item_created', { REAL_RAW_ITEM_CREATED: result.item ? 'YES' : 'NO', rawItem: result.item ? { productId: String(result.item.productId || ''), displayName: String(result.item.displayName || ''), quantity: result.item.quantity, unitPrice: result.item.unitPrice } : null })
      if (!result.ok) {
        markRealClickDiagnostic('build_or_normalize_error', { REAL_ERROR_STAGE: result.stage || 'BUILD' })
        recordSafeUiError('ADD_TO_CART', new Error(result.error), { product: p?.name || p?.id, stage: result.stage })
        setCashierToast('تعذر إضافة المنتج بسبب بيانات غير مكتملة')
        return
      }
      markRealClickDiagnostic('normalized_item_created', { REAL_NORMALIZED_ITEM_CREATED: 'YES', normalizedItem: result.itemSummary, activeOrderAfter: result.orderSummary })
      window.__POS101_LAST_CART_ITEM_SUMMARY__ = result.itemSummary
      markRealClickDiagnostic('set_active_order_called', { REAL_SET_ACTIVE_ORDER_CALLED: 'YES', pendingLocalStorageSave: true, pendingRenderAfterSetState: true })
      update(() => result.nextOrder)
      setCartScrollRequest(v => v + 1)
      setModal(null)
      markRealClickDiagnostic('modal_close_reached', { REAL_MODAL_CLOSE_REACHED: 'YES' })
    } catch (error) {
      markRealClickDiagnostic('real_click_error', { REAL_ERROR_STAGE: 'REAL_ADD_HANDLER' })
      recordSafeUiError('REAL_OPTIONS_ADD', error, { product: p?.name || p?.id })
      setCashierToast('تعذر إضافة المنتج بسبب بيانات غير مكتملة')
    }
  }, [activeOrder, update])
  const selectProduct = useCallback(p => {
    try {
      window.__POS101_LAST_PRODUCT_CLICKED__ = { name: String(p?.name || ''), id: String(p?.id || ''), timestamp: new Date().toISOString() }
      if (p.variantProducts?.length) { setSelected(p); setModal('variants'); return }
      if (p.configurable) { window.__POS101_LAST_MODAL_PRODUCT__ = { name: String(p?.name || ''), id: String(p?.id || ''), timestamp: new Date().toISOString() }; setSelected(p); setModal('options'); return }
      addProduct({ ...p, quantity: 1 })
    } catch (error) {
      recordSafeUiError('PRODUCT_CLICK_HANDLER', error, { product: p?.name || p?.id })
      setCashierToast(error?.message || 'تعذر إضافة المنتج')
    }
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
    if (!session || !session.shiftType || !session.shiftId) {
      setOperationalDayError('ابدأ الشفت أولاً')
      setModal('operational-day-required')
      return false
    }
    if (!activeOrder.items.length || saleInFlight.current || ['BUILDING', 'WRITING_FIREBASE', 'READING_BACK'].includes(saleEngine.getState().state)) return false
    void readCashierSaleSyncDiagnostics()
    setPendingPayment(payment)
    setModal('seller-selection')
    return true
  }, [session, activeOrder.items.length])

  const finalizeSale = useCallback(async (sellerName) => {
    if (!session || !session.shiftType || !session.shiftId || !activeOrder.items.length || saleInFlight.current || !pendingPayment) return false
    saleInFlight.current = true
    lastSellerName.current = sellerName
    setCashierSyncPhase('saving')
    const result = await saleEngine.sell({
      activeOrder,
      payment: pendingPayment,
      sellerName,
      session,
      subtotal,
      discount: activeDiscount,
      total,
    })
    if (!result.ok) {
      setCashierSyncPhase(result.state === 'FAILED_RETRYABLE' ? 'pending' : 'failed')
      setSaleSyncWarning(result.errorMessageAr || 'فشل إرسال الطلب. لم يتم حذف الطلب من السلة.')
      if (!result.shouldRetrySamePayload) lastSellerName.current = ''
      setModal('seller-selection')
      saleInFlight.current = false
      return false
    }
    setSaleSyncWarning(result.diagnostics?.localCacheWarning || '')
    if (result.diagnostics?.localCacheWarning) recordSafeUiError('CENTRAL_SALE_LOCAL_CACHE', new Error(result.diagnostics.localCacheWarning), { saleId: result.saleId })
    if (autoPrint) await requestSalePrint(result.sale)
    setOrders(v => v.map((o, i) => i === active ? blankOrder(o.id) : o))
    setPendingPayment(null)
    setCashierSyncPhase('saved')
    window.setTimeout(() => setCashierSyncPhase(current => current === 'saved' ? 'idle' : current), 1800)
    window.dispatchEvent(new CustomEvent('pos101-cashier-toast', { detail: 'تم تثبيت الطلب' }))
    window.setTimeout(() => setModal(null), 350)
    saleInFlight.current = false
    return true
  }, [session, activeOrder, subtotal, total, activeDiscount, active, autoPrint, pendingPayment, requestSalePrint])

  const handleVoidSale = useCallback(async sale => {
    const saleId = sale?.saleId || sale?.id
    if (!saleId) throw new Error('معرف البيع غير موجود.')
    const voidedAt = Number(sale?.voidedAt) || Date.now()
    const audit = { id: sale?.audit?.find?.(row => row?.type === 'void')?.id || `void-${saleId}-${voidedAt}`, type: 'void', at: voidedAt, cashierId: session?.cashierId || session?.shiftId || null, cashierNameSnapshot: session?.name || session?.shiftName || '', reason: '' }
    const pending = { ...sale, id: saleId, saleId, status: 'void_pending_sync', voided: true, voidedAt, audit: [...(Array.isArray(sale.audit) ? sale.audit : []), audit] }
    const writeLocalPending = next => {
      const sales = readLocalSales()
      const nextSales = sales.map(row => (row.saleId || row.id) === saleId ? next : row)
      writeSalesCache(nextSales)
      window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: next }))
      return next
    }
    writeLocalPending(pending)
    const voidPayload = { saleId, voidedAt, voidedBy: session?.cashierId || session?.shiftId || '', cashierId: session?.cashierId || session?.shiftId || '', cashierNameSnapshot: session?.name || session?.shiftName || '', voidReason: '', audit }
    try {
      const result = await voidCentralSaleImmediately(pending, { voidPayload, audit })
      if (result.neverExisted) {
        resolveVoidedSaleLocally(pending, { queueResolution: 'voided_before_central_sync', reason: 'Sale was voided before central creation' })
        setSaleSyncWarning('تم إبطال الطلب محليًا قبل وجوده مركزيًا؛ لا أثر مالي مركزي له')
      } else {
        markSaleVoidedCentral(pending, { voidConfirmedAt: Date.now(), queueResolution: 'void_status_synced', audit: result.audit })
        setSaleSyncWarning('')
      }
      setCashierSyncPhase('saved')
      window.setTimeout(() => setCashierSyncPhase(current => current === 'saved' ? 'idle' : current), 1800)
      window.dispatchEvent(new CustomEvent('pos101-cashier-toast', { detail: 'تم تثبيت الإبطال' }))
      return result.sale || pending
    } catch (error) {
      enqueueVoidUpdate(pending, voidPayload, { error })
      setCashierSyncPhase('pending')
      setSaleSyncWarning('تعذر تثبيت الإبطال مركزيًا. تحقق من الإنترنت أو أبلغ المدير.\nيوجد طلب محفوظ مؤقتًا وسيُعاد رفعه تلقائيًا.')
      console.warn('POS101_IMMEDIATE_VOID_SYNC_PENDING', error?.code || error?.message || String(error))
      void processSaleSyncQueue({ reason: 'void-update-failure' }).catch(retryError => console.warn('POS101_VOID_FAILURE_RETRY_ERROR', retryError?.code || retryError?.message || String(retryError)))
      return pending
    }
  }, [session])

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
      shiftType: cashier.shiftType || cashier.shiftId,
      shiftLabel: cashier.shiftLabel || (cashier.shiftId === 'morning' ? 'صباحي' : 'مسائي'),
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
  useEffect(() => {
    if (!adminReady) {
      setCentralPendingDiagnostics([])
      setCentralPendingDiagnosticsReport(null)
      return undefined
    }
    void refreshCentralPendingDiagnostics().catch(error => console.warn('CENTRAL_PENDING_DIAGNOSTICS_READ_FAILED', error?.code || error?.message || String(error)))
    return undefined
  }, [adminReady, centralAuthUser?.uid, refreshCentralPendingDiagnostics])
  const saveSaleEdit = useCallback((sale, changes) => changes?.itemCorrection ? correctCentralSaleItems(sale, changes) : updateCentralSale(sale, changes), [])
  const inspectBackup = useCallback(({ sales, syncQueueItems }) => inspectBackupSales({ sales, syncQueueItems }), [])
  const markBackupLocal = useCallback(({ sale, centralSale }) => markBackupSaleReadbackLocally({ sale, centralSale }), [])
  const recoverBackup = useCallback(payload => recoverBackupSale(payload), [])
  const repairBackup = useCallback(payload => runOneClickSyncRepair(payload), [])
  const productManagerReady = isCentralProductManager(productAuthUser)
  const staffManagerReady = canManageStaff(centralAuthUser, staffAuthorizationRecord)
  const backupRecoveryVisible = Boolean(!session && (adminReady || staffManagerReady))
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
    if (view === 'backup-recovery' && !backupRecoveryVisible) return
    setCurrentView(view)
  }, [adminReady, backupRecoveryVisible, currentView])
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

  const cashierSyncState = useMemo(() => {
    if (cashierSyncPhase === 'saving') return { state: 'saving', label: 'جاري الحفظ...' }
    if (!isOnline || !centralAuthReady || !centralAuthUser) return { state: 'offline', label: 'بانتظار الاتصال' }
    const pendingBadgeState = {
      show: headerPendingDiagnostic.badgeShow === true,
      reason: headerPendingDiagnostic.badgeReason || '',
      blockers: headerPendingDiagnostic.badgeBlockers || [],
      sourceComponent: headerPendingDiagnostic.badgeSourceComponent,
    }
    if (pendingBadgeState.show) return { state: 'pending', label: 'يوجد طلب غير مثبت', pendingBadgeState }
    if (cashierSyncPhase === 'saved') return { state: 'saved', label: 'محفوظ', pendingBadgeState }
    return { state: 'connected', label: 'متصل', pendingBadgeState }
  }, [cashierSyncPhase, isOnline, centralAuthReady, centralAuthUser, headerPendingDiagnostic])

  useEffect(() => {
    if (currentView === 'backup-recovery' && !backupRecoveryVisible) setCurrentView('dashboard')
  }, [currentView, backupRecoveryVisible])

  const sellingBlocked = !activeShift || !operationalDayCentralReady || operationalDay?.status !== 'open'

  useEffect(() => {
    const blockReasons = []
    if (!centralAuthReady) blockReasons.push('AUTH_NOT_READY')
    if (!centralAuthUser || !isCentralCashierUser(centralAuthUser)) blockReasons.push('AUTHORIZED_POS_USER_MISSING')
    if (!operationalDayCentralReady) blockReasons.push('CENTRAL_DAY_NOT_READY')
    if (operationalDay?.status !== 'open') blockReasons.push('CENTRAL_DAY_NOT_OPEN')
    if (!activeShift) blockReasons.push('ACTIVE_SHIFT_MISSING')
    const diagnostics = {
      AUTH_READY: centralAuthReady ? 'PASS' : 'FAIL',
      AUTHORIZED_POS_USER: centralAuthUser && isCentralCashierUser(centralAuthUser) ? 'PASS' : 'FAIL',
      CENTRAL_DAY_STATUS: operationalDay?.status || 'unknown',
      LOCAL_DAY_STATUS: readLocalOperationalDay()?.status || 'unknown',
      ACTIVE_SHIFT_STATUS: activeShift ? 'active' : 'inactive',
      SALE_ALLOWED: sellingBlocked ? 'NO' : 'YES',
      BLOCK_REASON: blockReasons.join(',') || 'NONE',
      SYNC_STATUS: cashierSyncState.state,
      CART_LENGTH: activeOrder.items.length,
      SELL_BUTTON_DISABLED_REASON: activeOrder.items.length ? 'NONE' : 'CART_EMPTY',
      PRODUCT_GRID_CLICKABLE: sellingBlocked ? 'FAIL' : 'PASS',
      CART_PANEL_CLICKABLE: sellingBlocked ? 'FAIL' : 'PASS',
      SELL_BUTTON_CLICKABLE: activeOrder.items.length ? 'PASS' : 'FAIL',
    }
    window.__POS101_CASHIER_DIAGNOSTICS__ = diagnostics
    console.info('POS101_CASHIER_DIAGNOSTICS', diagnostics)
  }, [activeOrder.items.length, activeShift, centralAuthReady, centralAuthUser, cashierSyncState.state, operationalDay, operationalDayCentralReady, sellingBlocked])

  useEffect(() => {
    window.__POS101_ACTIVE_ORDER_SUMMARY__ = {
      id: String(activeOrder?.id || ''),
      itemCount: activeOrder.items.length,
      itemShapes: activeOrder.items.map(item => ({
        cartItemId: item.cartItemId,
        productId: item.productId,
        displayName: item.displayName,
        options: Array.isArray(item.options),
        additions: Array.isArray(item.additions),
        price: Number.isFinite(item.price),
        quantity: Number.isFinite(item.quantity),
      })),
      businessDate: operationalDay?.businessDate || null,
      dayStatus: operationalDay?.status || null,
      shift: session?.shiftType || null,
    }
  }, [activeOrder, operationalDay?.businessDate, operationalDay?.status, session?.shiftType])

  useEffect(() => {
    const diagnostic = window.__POS101_REAL_CLICK_DIAGNOSTIC__
    if (diagnostic?.pendingRenderAfterSetState) {
      markRealClickDiagnostic('render_after_setstate_reached', { REAL_RENDER_AFTER_SETSTATE_REACHED: 'YES', pendingRenderAfterSetState: false })
    }
  }, [activeOrder])

  const kioskAuthReady = Boolean(centralAuthUser && isKioskAuthenticatedUser(centralAuthUser))
  if (isCentralConfigured() && !centralAuthReady) return null
  if (isCentralConfigured() && !kioskAuthReady && !adminReady) return <KioskActivation onActivate={activateKiosk} busy={kioskActivationBusy} error={kioskActivationError} onAdminLogin={loginAdmin} adminBusy={adminAuthBusy} adminError={adminAuthError} />

  return (
    <main className={`app-shell ${currentView === 'settings' ? 'settings-app-shell' : ''} ${currentView === 'cashbox' ? 'cashbox-app-shell' : ''} ${currentView === 'employees' ? 'employees-app-shell' : ''} ${currentView === 'reports' || currentView === 'reports-captain' ? 'reports-app-shell' : ''} ${currentView === 'backup-recovery' ? 'backup-recovery-app-shell' : ''}`}>
      {versionStatus === 'updating' && <div className="pos101-update-status" role="status" aria-live="polite">جاري تحديث النظام...</div>}
      {(versionStatus === 'deferred' || versionStatus === 'pending') && versionBlocked && <div className="pos101-update-notice" role="status" aria-live="polite">يتوفر تحديث للنظام وسيتم تطبيقه بعد إكمال الطلب الحالي.</div>}
      {saleSyncWarning && <div className="pos101-sync-blocking-warning" role="alert" aria-live="assertive">{saleSyncWarning}</div>}
      {cashierToast && <div className="cashier-success-toast" role="status" aria-live="polite">{cashierToast}</div>}
      {new URLSearchParams(window.location.search).has('cashbox-debug') && cashboxDiagnostic && <pre data-testid="cashbox-debug" style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left' }}>{JSON.stringify(cashboxDiagnostic)}</pre>}
      {new URLSearchParams(window.location.search).has('cashbox-debug') && ['timeout', 'auth_failed', 'permission_denied', 'error'].includes(cashboxDiagnostic?.status) && <p role="alert">تعذر إكمال فحص Firebase: {cashboxDiagnostic.error || cashboxDiagnostic.reason || cashboxDiagnostic.status}</p>}
      {session && operationalDay?.status === 'closed' && <div className="pos101-sync-blocking-warning" role="alert" aria-live="assertive">اليوم التشغيلي مغلق. افتح يومًا جديدًا قبل البيع.</div>}
      {session && (
        <Header
          session={session}
          onOpenOrders={() => setModal('openOrders')}
          onCashierMenu={() => setModal('cashier-menu')}
          onLogout={logout}
          openOrdersCount={openOrdersCount}
          onDownloadSalesBackup={downloadSalesBackup}
          syncStatus={cashierSyncState}
          currentView={currentView}
          onNavigate={requestView}
          onSafeCheck={runSafeCheck}
          onTestFlow={runSafeCheck}
          onTestRealAdd={runRealOptionsAddTest}
          safeCheckState={safeCheckState}
        />
      )}

      {currentView === 'dashboard' && (session || adminReady || staffManagerReady) && (
        <Dashboard onNavigate={requestView} onLogout={logout} canAccessBackupRecovery={backupRecoveryVisible} operationalDayEnabled={Boolean(session || adminReady)} operationalDay={operationalDay} operationalDaySummary={operationalDaySummary} settlementPreview={settlementPreview} preCloseGuard={preCloseGuard} pendingTableCount={pendingTables.filter(row => row.status === 'open').length} onPrepareEnd={prepareEndOperationalDay} onPrepareStart={prepareStartOperationalDay} operationalDayLoading={operationalDayLoading} operationalDayError={operationalDayError} onStartOperationalDay={handleStartOperationalDay} onSetOpeningCashBalance={handleSetOpeningCashBalance} onEndOperationalDay={handleEndOperationalDay} onReadDiagnostic={readDiagnostic} canViewDiagnostics={adminReady} />
      )}

      {currentView === 'settings' && (session || adminReady || staffManagerReady) && (
        <Settings products={catalogProducts} categories={catalogCategories} canWrite={productManagerReady} canManageStaff={staffManagerReady} canAccessBackupRecovery={backupRecoveryVisible} onStaffSignIn={ensureStaffAuth} staffAuthBusy={staffAuthBusy} staffAuthError={staffAuthError} onSave={saveProduct} onNavigate={requestView} discountPresets={discountPresets} onSaveDiscountPresets={setDiscountPresets} staff={staff} onSaveStaff={saveCentralStaff} />
      )}
      {currentView === 'employees' && (session || adminReady || staffManagerReady) && <Employees staff={staff} canWrite={staffManagerReady} onStaffSignIn={ensureStaffAuth} staffAuthBusy={staffAuthBusy} staffAuthError={staffAuthError} onSaveStaff={saveCentralStaff} onSaveStaffPin={savePin} onNavigate={requestView} />}
      {currentView === 'cashbox' && (session || adminReady) && <FinancialCenter transactions={cashboxTransactions} centralSales={centralSales} cashboxSales={centralSales} operationalDays={centralOperationalDays} operationalDay={operationalDay} settlements={settlements} settlementCorrections={settlementCorrections} onSaveSettlementCorrection={saveSettlementCorrection} onSaveTransaction={saveCashboxTransaction} onUpdateTransaction={updateCashboxTransaction} onVoidTransaction={voidCashboxTransaction} onSaveCashCount={saveCashCount} onNavigate={setCurrentView} adminDiagnostic={Boolean(adminReady && !session)} />}

      {currentView === 'orders' && (session || adminReady) && (
        <OrderHistoryMenu
          session={session}
          salesOverride={adminReady ? adminCentralSales : centralSales.length ? centralSales : null}
          readOnly={false}
          onEditSale={saveSaleEdit}
          canCorrectSaleItems
          staff={staff}
          correctionActor={centralAuthUser || adminAuthUser}
          correctionAuthorization={staffAuthorizationRecord}
          onVoidSale={handleVoidSale}
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
            disabled={false}
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
            disabled={false}
          />
          {modal === 'history' && <OrderHistoryMenu session={session} salesOverride={centralSales.length ? centralSales : null} onEditSale={saveSaleEdit} onVoidSale={handleVoidSale} canCorrectSaleItems staff={staff} correctionActor={centralAuthUser || adminAuthUser} correctionAuthorization={staffAuthorizationRecord} onClose={() => setModal(null)} />}
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
          onBeforePrint={syncBeforeReportPrint}
          onDirectThermalPrint={session ? printReportDirect : undefined}
          directThermalReady={Boolean(session && directThermalReady)}
        />
      )}
      {currentView === 'expenses' && session && (
        <Expenses session={session} operationalDay={operationalDay} staff={staff} onNavigate={requestView} />
      )}
      {currentView === 'expense-entry' && session && (
        <Expenses session={session} operationalDay={operationalDay} staff={staff} onNavigate={requestView} />
      )}
      {currentView === 'reports-captain' && session && <Reports session={session} operationalDay={operationalDay} centralSales={centralSales} operationalDays={centralOperationalDays} settlements={settlements} cashboxTransactions={cashboxTransactions} staff={staff} products={catalogProducts} categories={catalogCategories} initialReportType="captain" onNavigate={requestView} onBeforePrint={syncBeforeReportPrint} />}

      {currentView === 'backup-recovery' && backupRecoveryVisible && (
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
          <CentralPendingDiagnostics rows={centralPendingDiagnostics} report={centralPendingDiagnosticsReport} busy={centralPendingDiagnosticsBusy} onRefresh={() => refreshCentralPendingDiagnostics()} onReconcile={() => refreshCentralPendingDiagnostics({ reconcile: true })} />
          <Reports session={{ name: 'الإدارة', status: 'admin-readonly' }} operationalDay={operationalDay} cashboxTransactions={cashboxTransactions} staff={staff} salesOverride={adminCentralSales} products={catalogProducts} categories={catalogCategories} onNavigate={() => {}} onBeforePrint={syncBeforeReportPrint} />
        </section>
      )}

      {/* Login gate */}
      {(!session || !activeShift) && !adminReady && (
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
      {modal === 'cashier-menu' && <CashierMenu session={session} settlementPreview={settlementPreview} onClose={() => setModal(null)} onLogout={logout} />}
      {modal === 'financial-pin' && <FinancialPinDialog staff={staff} onClose={() => { setFinancialPinTarget(null); setModal(null) }} onUnlock={unlockFinancialView} />}
      {modal === 'operational-day-required' && <div className="overlay"><div className="dialog operational-day-required-dialog" dir="rtl"><h2>{operationalDayError ? 'تعذر إكمال البيع' : 'يجب بدء اليوم التشغيلي أولاً'}</h2><p>{operationalDayError || 'لن يتم إكمال البيع أو مسح السلة قبل بدء يوم تشغيلي مركزي.'}</p><div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => { setModal(null); setOperationalDayError('') }}>رجوع</button><button type="button" className="primary-action" onClick={() => { setModal(null); setOperationalDayError(''); setCurrentView('dashboard') }}>الانتقال إلى بدء اليوم</button></div></div></div>}
      {modal === 'storage-quota' && <div className="overlay"><div className="dialog operational-day-required-dialog" dir="rtl"><h2>امتلأت ذاكرة الجهاز المحلية</h2><p>البيع المركزي آمن إذا تم تأكيده من Firebase. سيتم تنظيف الكاش المحلي بدون حذف المبيعات.</p><div className="dialog-actions"><button type="button" className="primary-action" onClick={() => { setModal(null); void runSafeCheck() }}>فحص وإصلاح النظام</button><button type="button" className="primary-action" onClick={() => { setModal(pendingPayment ? 'seller-selection' : 'payment'); setOperationalDayError('') }}>إعادة المحاولة بعد الفحص</button><button type="button" className="secondary-action" onClick={() => { setModal(null); setOperationalDayError('') }}>رجوع</button></div></div></div>}
      {modal === 'confirm-clear' && <ConfirmDialog title="تفريغ سلة المشتريات" message="سيتم مسح العناصر الحالية ولا يمكن التراجع عن العملية." onClose={() => setModal(null)} onConfirm={() => { clearCart(); setModal(null) }} />}
      {modal === 'save-pending-table' && <SavePendingTableDialog total={total} session={session} onClose={() => setModal(null)} onSave={saveCurrentPendingTable} />}
      {modal === 'print-menu' && <PrintMenu enabled={autoPrint} settings={printerSettings} thermalStatus={thermalStatus} onClose={() => setModal(null)} onChange={v => setAutoPrint(v)} onSave={savePrinterSettings} onCheck={settings => refreshThermalStatus({ ...printerSettings, ...settings })} onDirectChange={v => setPrinterSettings(s => ({ ...s, directThermal: v }))} />}
      {modal === 'options' && <ProductOptions product={selected} onClose={() => setModal(null)} onAdd={addProduct} />}
      {modal === 'variants' && selected && <VariantModal product={selected} variants={selected.variantProducts || []} onClose={() => setModal(null)} onSelect={child => selectVariant(selected, child)} />}
      {modal === 'orderType' && <OrderType onClose={() => setModal(null)} onChoose={chooseType} />}
      {modal === 'tables' && <TableSelection orders={orders} onClose={() => setModal(null)} onChoose={chooseTable} />}
      {modal === 'payment' && <Payment total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'quickCash' && <QuickCash total={total} onClose={() => setModal(null)} onSuccess={initiateComplete} />}
      {modal === 'seller-selection' && <SellerSelection staff={staff} staffStatus={staffStatus} saleSyncWarning={saleSyncWarning} retrySellerName={lastSellerName.current} onClose={() => setModal(null)} onSelect={finalizeSale} />}
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
      {pendingSaleDialog && <PendingSaleStatusDialog entries={pendingSaleDialog.entries} check={pendingSaleDialog.check} busy={pendingSaleActionBusy} onCheck={checkPendingSale} onRetry={retryPendingSale} onClose={() => setPendingSaleDialog(null)} />}
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
