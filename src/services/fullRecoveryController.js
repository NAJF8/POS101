import { centralAuth, isAuthorizedPosSyncUser, readLocalExpenses, runFullRecoverySync, saveLocalExpensePending, signInCentralWithGoogle } from './posCentralSync.js'
import { areExpenseDuplicates, getLocalDateKey, normalizeDateKey, normalizeExpense, resolveExpenseBusinessDate } from './expenseReporting.js'

const readJson = (key, fallback) => {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value === null ? fallback : value } catch { return fallback }
}

export const createFullRecoveryBackup = () => {
  const timestamp = new Date().toISOString()
  const key = `pos101.fullRecoveryBackup.${timestamp}`
  const snapshot = {
    timestamp,
    sales: readJson('pos101.sales', []),
    expenses: readJson('pos101.expenses', []),
    operationalDay: readJson('pos101.operationalDay', null),
    session: readJson('pos101.session', null),
    deviceId: localStorage.getItem('pos101.deviceId') || '',
  }
  localStorage.setItem(key, JSON.stringify(snapshot))
  return { key, timestamp, snapshot }
}

const hasExpenseContext = value => ['businessDate', 'date', 'createdAt', 'notes', 'description', 'category']
  .some(key => value?.[key] !== undefined && value?.[key] !== null && String(value[key]).trim() !== '')
const normalizeNumericText = value => String(value ?? '').replace(/[،٬,]/g, '').replace(/[٠-٩۰-۹]/g, digit => {
  const index = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)
  return String(index >= 10 ? index - 10 : index)
})

export const isExpenseCandidate = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const amount = Number(normalizeNumericText(value.amount))
  return Number.isFinite(amount) && amount > 0 && hasExpenseContext(value)
}

const collectExpenseCandidates = (value, path, output, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (isExpenseCandidate(value)) output.push({ raw: value, path })
  if (Array.isArray(value)) value.forEach((child, index) => collectExpenseCandidates(child, `${path}[${index}]`, output, seen))
  else Object.entries(value).forEach(([key, child]) => {
    if (child && typeof child === 'object') collectExpenseCandidates(child, `${path}.${key}`, output, seen)
  })
}

const readOperationalDayDates = () => {
  const value = readJson('pos101_operational_days', {})
  const entries = Array.isArray(value) ? value.map(row => [row?.id || row?.operationalDayId, row]) : Object.entries(value || {})
  return Object.fromEntries(entries.map(([id, row]) => [String(id || row?.operationalDayId || ''), normalizeDateKey(row?.businessDate)]).filter(([id, date]) => id && date))
}

const normalizeRecoveredExpense = (raw, operationalDayDates) => {
  const businessDate = resolveExpenseBusinessDate(raw, { operationalDayDates }) || getLocalDateKey(raw?.date || raw?.createdAt)
  const amount = Number(normalizeNumericText(raw?.amount))
  return {
    ...normalizeExpense({ ...raw, amount, businessDate }),
    amount,
    businessDate,
    category: String(raw?.category || raw?.type || 'أخرى').trim() || 'أخرى',
    person: String(raw?.person || raw?.employee || raw?.cashierName || '').trim() || 'غير محدد',
    notes: String(raw?.notes || raw?.description || '').trim(),
    description: String(raw?.description || raw?.notes || '').trim(),
  }
}

export const scanAllExpenseBackups = () => {
  const existing = readLocalExpenses()
  const operationalDayDates = readOperationalDayDates()
  const candidates = []
  const keys = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key) continue
    keys.push(key)
    const value = readJson(key, null)
    // Inspect the current ledger for diagnostics, but do not offer its own
    // rows as recovered candidates; they are already in the system.
    if (value !== null && key !== 'pos101.expenses') collectExpenseCandidates(value, key, candidates)
  }
  const recovered = []
  let duplicateCount = 0
  for (const candidate of candidates) {
    const row = normalizeRecoveredExpense(candidate.raw, operationalDayDates)
    if (!row.amount) continue
    const duplicate = [...existing, ...recovered].some(item => areExpenseDuplicates(item, row))
    if (duplicate) { duplicateCount += 1; continue }
    recovered.push({ ...row, id: row.id || `recovered-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${recovered.length}`}`, recoverySource: candidate.path, recoveryStatus: row.businessDate ? 'جديد' : 'غير محدد' })
  }
  return {
    scannedKeys: keys.length,
    currentCount: existing.length,
    candidatesCount: candidates.length,
    newCount: recovered.length,
    duplicateCount,
    withoutDateCount: recovered.filter(row => !row.businessDate).length,
    recoverableTotal: recovered.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    candidates: recovered,
    sources: [...new Set(recovered.map(row => String(row.recoverySource).split('.')[0]))],
  }
}

export const createExpenseRecoveryBackup = selectedExpenses => {
  const timestamp = new Date().toISOString()
  const key = `pos101.expenseRecoveryBackup.${timestamp}`
  const snapshot = {
    timestamp,
    currentExpenses: readLocalExpenses(),
    selectedRecoveredExpenses: selectedExpenses,
    operationalDayCache: readJson('pos101.operationalDay', null),
    operationalDays: readJson('pos101_operational_days', null),
    deviceId: localStorage.getItem('pos101.deviceId') || '',
  }
  localStorage.setItem(key, JSON.stringify(snapshot))
  return { key, timestamp, snapshot }
}

export const parseManualExpenseBulk = text => String(text || '').split(/\r?\n/).map((line, index) => {
  const parts = line.split('|').map(value => value.trim())
  if (!line.trim()) return null
  const [date, amountText, category, person, description] = parts
  const amount = Number(normalizeNumericText(amountText))
  const businessDate = normalizeDateKey(date)
  const errors = []
  if (!businessDate) errors.push('التاريخ غير صحيح')
  if (!Number.isFinite(amount) || amount <= 0) errors.push('المبلغ غير صحيح')
  if (parts.length > 5) errors.push('عدد الحقول أكبر من 5')
  return { line: index + 1, raw: line, valid: errors.length === 0, errors, expense: { id: `manual-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`}`, amount, businessDate, category: category || 'أخرى', person: person || 'غير محدد', notes: description || category || 'أخرى', description: description || category || 'أخرى', createdAt: Date.parse(`${businessDate}T12:00:00+03:00`), recoverySource: 'manual-bulk-recovery', shift: 'استرجاع يدوي', syncStatus: 'pending' } }
}).filter(Boolean)

export const recoverExpensesFromKnownBackups = () => {
  const scan = scanAllExpenseBackups()
  scan.candidates.forEach(row => saveLocalExpensePending(row))
  return { ...scan, recoveredCount: scan.newCount, localCountBefore: scan.currentCount, localCountAfter: readLocalExpenses().length }
}

export const createFullRecoveryClickHandler = ({ getCurrentUser = () => centralAuth()?.currentUser, signIn = signInCentralWithGoogle, runRecovery = runFullRecoverySync, onStart, onSuccess, onError } = {}) => {
  let busy = false
  return async function handleFullRecoveryClick() {
    if (busy) return { skipped: true }
    busy = true
    let backup = null
    try {
      const user = getCurrentUser() || await signIn()
      if (!await isAuthorizedPosSyncUser(user)) throw Object.assign(new Error('هذا الحساب غير مخول لإصلاح ومزامنة بيانات POS.'), { code: 'CENTRAL_ROLE_BLOCKED' })
      backup = createFullRecoveryBackup()
      onStart?.(backup)
      const result = await runRecovery()
      const complete = { backup, ...result }
      onSuccess?.(complete)
      return complete
    } catch (error) {
      const failure = { error, backup }
      onError?.(failure)
      return failure
    } finally { busy = false }
  }
}
