const SALES_KEY = 'pos101.sales'
const QUEUE_KEY = 'pos101.syncQueue'

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return value ?? fallback
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value))
const saleIdOf = sale => sale?.saleId || sale?.id
const sameSale = (sale, saleId) => saleIdOf(sale) === saleId
const isSaleEntry = entry => Boolean(entry?.sale && saleIdOf(entry.sale))

export const readSaleQueue = () => readJson(QUEUE_KEY, []).filter(entry => entry?.sale && saleIdOf(entry.sale))

export const pendingSale = (sale, error) => ({
  ...sale,
  status: 'pending_sync',
  ...(error ? { syncError: String(error?.message || error) } : {}),
})

// The local ledger is authoritative for the POS. Queueing is idempotent by
// saleId and deliberately retains the original operationKey for Firebase
// retries, including retries after a refresh.
export const enqueueSale = (sale, { error, queuedAt = Date.now() } = {}) => {
  const queuedSale = pendingSale(sale, error)
  const saleId = saleIdOf(queuedSale)
  if (!saleId) throw new Error('Cannot queue a sale without saleId.')
  const queue = readJson(QUEUE_KEY, []).filter(entry => !isSaleEntry(entry) || !sameSale(entry.sale, saleId))
  writeJson(QUEUE_KEY, [...queue, { kind: 'sale', sale: queuedSale, queuedAt }])

  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, [...sales.filter(row => !sameSale(row, saleId)), queuedSale])
  return queuedSale
}

export const markSaleSynced = (sale, syncConfirmedAt = Date.now()) => {
  const saleId = saleIdOf(sale)
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => sameSale(row, saleId)
    ? { ...row, status: 'synced', syncConfirmedAt }
    : row))
  writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(entry => !isSaleEntry(entry) || !sameSale(entry.sale, saleId)))
}

export const retainQueuedSale = (entry, error) => {
  const sale = pendingSale(entry.sale, error)
  const saleId = saleIdOf(sale)
  const queue = readJson(QUEUE_KEY, []).map(row => isSaleEntry(row) && sameSale(row.sale, saleId)
    ? { ...row, kind: 'sale', sale }
    : row)
  writeJson(QUEUE_KEY, queue)
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => sameSale(row, saleId) ? sale : row))
}
