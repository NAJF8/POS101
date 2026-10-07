import { BUILD_SHA } from './versionUpdate.js'

export const RECOVERY_TARGET_SALE_IDS = [
  'b7cadbed-f6aa-4817-9ded-73fe3b011092', '544092ff-551f-4471-b36b-86f9a4bb9668',
  '6c1c7255-4303-4645-85f3-dc375dff2e2a', '6832c823-a0ff-463d-b6f7-208cf3c712cd',
  '68c828ae-1f09-4980-9087-f9410f334cbc', '3cd2d052-a53e-4c5b-802e-8897537ff8da',
  'f49b7f05-4b9f-4549-a63d-d0e7a5bc2bcb', '2afeb665-4abc-463d-b3d2-e417b539a180',
]

const RECOVERY_KEYS = ['pos101.sales', 'pos101.syncQueue', 'pos101.salesQuarantine', 'pos101.operationalDay']
const saleIdOf = sale => String(sale?.saleId || sale?.id || '').trim()
const parseStored = raw => {
  if (raw === null) return null
  try { return JSON.parse(raw) } catch { return { __invalidJson: true, raw } }
}
const rowsOf = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []
const storageRead = (storage, key) => storage?.getItem?.(key) ?? null
const scriptBundle = documentImpl => {
  const scripts = documentImpl?.querySelectorAll?.('script[src]') || []
  const src = [...scripts].map(script => script.getAttribute('src') || '').find(value => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(value))
  return src ? src.split('/').pop().split('?')[0] : ''
}
const sha256 = async (raw, cryptoImpl = globalThis.crypto) => {
  if (!cryptoImpl?.subtle || typeof TextEncoder === 'undefined') return ''
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export const createRecoverySnapshot = async ({
  storage = globalThis.localStorage,
  now = () => new Date(),
  buildSha = BUILD_SHA,
  documentImpl = globalThis.document,
  cryptoImpl = globalThis.crypto,
} = {}) => {
  const clock = now()
  const timestamp = clock instanceof Date ? clock.toISOString() : new Date(clock).toISOString()
  const rawStorage = Object.fromEntries(RECOVERY_KEYS.map(key => [key, storageRead(storage, key)]))
  const parsedStorage = Object.fromEntries(Object.entries(rawStorage).map(([key, raw]) => [key, parseStored(raw)]))
  const sales = rowsOf(parsedStorage['pos101.sales'])
  const queue = rowsOf(parsedStorage['pos101.syncQueue'])
  const targetSet = new Set(RECOVERY_TARGET_SALE_IDS)
  const targetSales = sales.filter(row => targetSet.has(saleIdOf(row)))
  const targetQueueRecords = queue.filter(row => targetSet.has(saleIdOf(row?.sale || row)))
  const operationalDay = parsedStorage['pos101.operationalDay']
  return {
    snapshotType: 'POS101_CASHIER_RECOVERY_READ_ONLY', timestamp,
    app: { mainSha: String(buildSha || ''), buildId: String(buildSha || ''), bundle: scriptBundle(documentImpl) },
    kioskDeviceId: storageRead(storage, 'pos101.deviceId') || '',
    businessDate: operationalDay?.businessDate || targetSales.find(row => row.businessDate)?.businessDate || '',
    operationalDayId: operationalDay?.operationalDayId || operationalDay?.id || targetSales.find(row => row.operationalDayId)?.operationalDayId || '',
    localStorage: rawStorage,
    integrity: {
      recordCount: sales.length, queueCount: queue.length,
      targetRecordsFound: targetSales.length, targetQueueRecordsFound: targetQueueRecords.length,
      rawSalesSha256: await sha256(rawStorage['pos101.sales'] || '', cryptoImpl),
      rawSyncQueueSha256: await sha256(rawStorage['pos101.syncQueue'] || '', cryptoImpl),
    },
    targets: RECOVERY_TARGET_SALE_IDS.map(saleId => ({
      saleId,
      saleRecords: targetSales.filter(row => saleIdOf(row) === saleId),
      queueRecords: targetQueueRecords.filter(row => saleIdOf(row?.sale || row) === saleId),
    })),
    guarantees: { readOnly: true, firebaseWrites: false, localStorageWrites: false, queueProcessing: false, reconciliationMutation: false, saleResend: false },
  }
}

export const recoverySnapshotFilename = timestamp => `POS101-cashier-recovery-${String(timestamp).replace(/[:.]/g, '-')}.json`

export const downloadRecoverySnapshot = (snapshot, { documentImpl = globalThis.document, urlImpl = globalThis.URL } = {}) => {
  if (!documentImpl?.createElement || !urlImpl?.createObjectURL) throw new Error('تنزيل ملف الاستعادة غير متاح.')
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = urlImpl.createObjectURL(blob)
  const anchor = documentImpl.createElement('a')
  anchor.href = url
  anchor.download = recoverySnapshotFilename(snapshot.timestamp)
  anchor.click()
  urlImpl.revokeObjectURL?.(url)
  return anchor.download
}
