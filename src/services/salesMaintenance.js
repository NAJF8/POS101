const SALES_KEY = 'pos101.sales'
const FIRST_DELETE_ORDER = 1023
const LAST_DELETE_ORDER = 1050
const REQUIRED_ORDER_NUMBERS = [1051, 1052]
const NEW_ORDER_CUTOFF = 1052

const parseSales = storage => {
  const raw = storage.getItem(SALES_KEY)
  if (raw === null) throw new Error('لم يتم العثور على pos101.sales.')
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('pos101.sales لا يحتوي JSON صالحًا.') }
  if (!Array.isArray(parsed)) throw new Error('pos101.sales يجب أن يكون Array.')
  return parsed
}

const orderNumberOf = sale => {
  const value = Number(sale?.orderNumber)
  return Number.isInteger(value) ? value : null
}

const saleIdOf = sale => sale?.saleId || sale?.id || null
const duplicateSaleIds = sales => {
  const seen = new Set()
  const duplicates = new Set()
  for (const sale of sales) {
    const id = saleIdOf(sale)
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export const buildSalesMaintenancePlan = sales => {
  const deleteRows = sales.filter(sale => {
    const orderNumber = orderNumberOf(sale)
    return orderNumber >= FIRST_DELETE_ORDER && orderNumber <= LAST_DELETE_ORDER
  })
  const preservedRows = sales.filter(sale => !deleteRows.includes(sale))
  const newRows = sales.filter(sale => (orderNumberOf(sale) || 0) > NEW_ORDER_CUTOFF)
  const byOrder = order => sales.filter(sale => orderNumberOf(sale) === order)
  return {
    currentCount: sales.length,
    deleteRows,
    preservedRows,
    newRows,
    deleteOrderNumbers: deleteRows.map(orderNumberOf),
    required: REQUIRED_ORDER_NUMBERS.map(orderNumber => ({ orderNumber, count: byOrder(orderNumber).length, rows: byOrder(orderNumber) })),
    duplicateSaleIds: duplicateSaleIds(sales),
    nextNumber: null,
  }
}

const downloadJson = (backup, filename, download = true) => {
  if (!download || typeof document === 'undefined') return filename
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return filename
}

export const runSalesMaintenance = ({ storage = window.localStorage, download = true } = {}) => {
  const current = parseSales(storage)
  const plan = buildSalesMaintenancePlan(current)
  const missing = plan.required.filter(item => item.count === 0).map(item => item.orderNumber)
  if (missing.length) throw new Error(`السجلات المطلوبة غير موجودة: ${missing.map(value => `#${value}`).join('، ')}`)
  if (plan.duplicateSaleIds.length) throw new Error(`توجد saleId مكررة قبل الحذف: ${plan.duplicateSaleIds.join('، ')}`)

  const createdAt = new Date().toISOString()
  const backup = { createdAt, salesCount: current.length, [SALES_KEY]: current }
  if (backup.salesCount !== backup[SALES_KEY].length) throw new Error('فشل تحقق Backup قبل الكتابة.')
  const filename = `POS101-before-cleanup-${createdAt.replace(/[:.]/g, '-')}.json`
  downloadJson(backup, filename, download)

  const filtered = current.filter(sale => {
    const orderNumber = orderNumberOf(sale)
    return !(orderNumber >= FIRST_DELETE_ORDER && orderNumber <= LAST_DELETE_ORDER)
  })
  storage.setItem(SALES_KEY, JSON.stringify(filtered))

  const after = parseSales(storage)
  const afterPlan = buildSalesMaintenancePlan(after)
  const beforeNew = plan.newRows
  const missingNew = beforeNew.filter(beforeSale => !after.some(afterSale => sameJson(afterSale, beforeSale)))
  const deletedStillPresent = afterPlan.deleteRows.length
  const duplicateAfter = duplicateSaleIds(after)
  const requiredAfter = afterPlan.required.every(item => item.count >= 1)
  if (deletedStillPresent || !requiredAfter || missingNew.length || duplicateAfter.length) {
    throw new Error('فشل تحقق read-back بعد التنظيف.')
  }
  return { before: plan, after: afterPlan, backup, filename, deletedCount: plan.deleteRows.length, duplicateSaleIds: duplicateAfter }
}

export const salesMaintenanceConstants = { SALES_KEY, FIRST_DELETE_ORDER, LAST_DELETE_ORDER, REQUIRED_ORDER_NUMBERS, NEW_ORDER_CUTOFF }
