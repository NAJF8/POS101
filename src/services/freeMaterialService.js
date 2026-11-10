import { getLocalDateKey, normalizeDateKey } from './expenseReporting.js'

export const FREE_MATERIAL_STORAGE_KEY = 'pos101.freeMaterialMovements'
export const INVENTORY_MOVEMENTS_STORAGE_KEY = 'pos101.inventoryMovements'
export const INVENTORY_ITEMS_STORAGE_KEY = 'pos101.inventoryItems'

export const FREE_MATERIAL_TYPES = Object.freeze({
  gift: {
    type: 'gift',
    label: 'هدية',
    sectionTitle: 'هدايا',
    movementType: 'GIFT'
  },
  hospitality: {
    type: 'hospitality',
    label: 'ضيافة',
    sectionTitle: 'ضيافة',
    movementType: 'HOSPITALITY'
  },
  loyalty: {
    type: 'loyalty',
    label: 'ولاء',
    sectionTitle: 'ولاء',
    movementType: 'LOYALTY'
  }
})

export const ALLOWED_INVENTORY_MOVEMENT_TYPES = Object.freeze(['GIFT', 'HOSPITALITY', 'LOYALTY'])
export const FORBIDDEN_MOVEMENT_TYPES = new Set(['SALE', 'DISCOUNT'])
export const isFreeMaterialType = rawType => Boolean(normalizeFreeMaterialType(rawType))

const text = value => String(value ?? '').trim()

const positiveQuantity = value => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

/**
 * Resolves the reliable unit cost of a product/item.
 * Rules (Section 9):
 * - Use actual known Cost (cost / unitCost / costPrice), NEVER Selling Price (price / sellingPrice).
 * - If no reliable cost exists, DO NOT guess it: return { unitCost: null, totalCost: null, costKnown: false }.
 */
export const resolveReliableItemCost = (item = {}, product = null, inventoryItem = null) => {
  const candidates = [
    item?.cost,
    item?.unitCost,
    item?.costPrice,
    item?.actualCost,
    product?.cost,
    product?.unitCost,
    product?.costPrice,
    product?.actualCost,
    inventoryItem?.cost,
    inventoryItem?.unitCost,
    inventoryItem?.costPrice,
    inventoryItem?.actualCost
  ]

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

export const normalizeFreeMaterialType = rawType => {
  const normalized = text(rawType).toLowerCase()
  if (normalized === 'gift' || normalized === 'هدية' || normalized === 'هدايا') return 'gift'
  if (normalized === 'hospitality' || normalized === 'ضيافة' || normalized === 'ضيافه') return 'hospitality'
  if (normalized === 'loyalty' || normalized === 'ولاء') return 'loyalty'
  return ''
}

export const inventoryMovementTypeFor = freeType => {
  const normalized = normalizeFreeMaterialType(freeType)
  const meta = FREE_MATERIAL_TYPES[normalized]
  if (!meta) {
    throw new Error(`نوع المادة المجانية غير صالح: ${freeType}`)
  }
  if (FORBIDDEN_MOVEMENT_TYPES.has(meta.movementType)) {
    throw new Error(`غير مسموح باستخدام حركة مبيعات أو خصم للمواد المجانية: ${meta.movementType}`)
  }
  return meta.movementType
}

const makeId = prefix => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const getStorage = customStorage => {
  if (customStorage) return customStorage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

const readJsonList = (storage, key) => {
  const store = getStorage(storage)
  if (!store) return []
  try {
    const raw = store.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : Object.values(parsed || {})
  } catch {
    return []
  }
}

const writeJsonList = (storage, key, list) => {
  const store = getStorage(storage)
  if (!store) return
  try {
    store.setItem(key, JSON.stringify(Array.isArray(list) ? list : []))
  } catch {
    // Best-effort storage write
  }
}

export const normalizeFreeMaterialItem = (rawItem = {}, { productsById = new Map(), inventoryById = new Map() } = {}) => {
  const productId = text(rawItem?.productId || rawItem?.product_id || rawItem?.id)
  const product = productId ? productsById.get(productId) || null : null
  const inventoryItemId = text(
    rawItem?.inventoryItemId ||
    rawItem?.inventory_item_id ||
    product?.inventoryItemId ||
    product?.inventory_item_id ||
    (inventoryById.has(productId) ? productId : '')
  )
  const inventoryItem = inventoryItemId ? inventoryById.get(inventoryItemId) || null : null
  const trackInventory = Boolean(
    rawItem?.trackInventory ||
    rawItem?.linkedToInventory ||
    product?.trackInventory ||
    product?.linkedToInventory ||
    inventoryItemId ||
    inventoryItem
  )

  const quantity = positiveQuantity(rawItem?.quantity ?? rawItem?.qty ?? 1)
  if (quantity <= 0) {
    throw new Error('كمية المادة المجانية يجب أن تكون أكبر من صفر.')
  }

  const name = text(rawItem?.name || rawItem?.productName || product?.name || inventoryItem?.name)
  if (!name) {
    throw new Error('اسم المادة المجانية مطلوب.')
  }

  const category = text(rawItem?.category || product?.category || inventoryItem?.category || 'عام')
  const sellingPriceReference = Number.isFinite(Number(rawItem?.price ?? product?.price))
    ? Number(rawItem?.price ?? product?.price)
    : null

  const unitCost = resolveReliableItemCost(rawItem, product, inventoryItem)
  const costKnown = unitCost !== null
  const totalCost = costKnown ? Math.round(unitCost * quantity * 100) / 100 : null

  return {
    productId: productId || `item-${name}`,
    name,
    category,
    quantity,
    unitCost,
    totalCost,
    cost: totalCost,
    costKnown,
    sellingPriceReference,
    trackInventory,
    inventoryItemId: inventoryItemId || (trackInventory ? (productId || `inv-${name}`) : '')
  }
}

export const createFreeMaterialRecord = ({
  id,
  type,
  recipientName = '',
  items = [],
  products = [],
  inventoryItems = [],
  businessDate = '',
  operationalDayId = '',
  shiftId = '',
  shiftType = '',
  shiftLabel = '',
  cashierId = '',
  cashierName = '',
  createdBy = '',
  note = '',
  createdAt = Date.now()
} = {}) => {
  const normalizedType = normalizeFreeMaterialType(type)
  if (!normalizedType) {
    throw new Error('نوع العملية المجانية غير صالح. الأنواع المسموحة: gift, hospitality, loyalty.')
  }

  const meta = FREE_MATERIAL_TYPES[normalizedType]
  const movementType = inventoryMovementTypeFor(normalizedType)

  const productsById = new Map(
    (Array.isArray(products) ? products : []).map(p => [text(p?.id || p?.productId), p])
  )
  const inventoryById = new Map()
  for (const inv of (Array.isArray(inventoryItems) ? inventoryItems : [])) {
    if (text(inv?.id)) inventoryById.set(text(inv.id), inv)
    if (text(inv?.inventoryItemId)) inventoryById.set(text(inv.inventoryItemId), inv)
    if (text(inv?.productId)) inventoryById.set(text(inv.productId), inv)
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('يجب اختيار مادة واحدة على الأقل لتسجيل العملية المجانية.')
  }

  const normalizedItems = items.map(item =>
    normalizeFreeMaterialItem(item, { productsById, inventoryById })
  )

  const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0)
  const knownCostItems = normalizedItems.filter(item => item.costKnown && Number.isFinite(item.totalCost))
  const totalKnownCost = knownCostItems.length > 0
    ? knownCostItems.reduce((sum, item) => sum + item.totalCost, 0)
    : null
  const allCostsKnown = normalizedItems.every(item => item.costKnown)
  const anyCostKnown = knownCostItems.length > 0

  const resolvedTimestamp = Number.isFinite(Number(createdAt)) && Number(createdAt) > 0
    ? Number(createdAt)
    : Date.now()
  const resolvedBusinessDate = normalizeDateKey(businessDate) || getLocalDateKey(resolvedTimestamp)
  const recordId = text(id) || makeId('free')

  const cleanRecipientName = normalizedType === 'hospitality'
    ? text(recipientName)
    : text(recipientName)

  const inventoryMovements = normalizedItems
    .filter(item => item.trackInventory || Boolean(item.inventoryItemId))
    .map((item, idx) => {
      if (FORBIDDEN_MOVEMENT_TYPES.has(movementType)) {
        throw new Error('لا يجوز استخدام حركة SALE أو DISCOUNT للمواد المجانية.')
      }
      return {
        id: `${recordId}-mov-${idx + 1}`,
        freeMaterialId: recordId,
        movementType,
        freeMaterialType: normalizedType,
        direction: 'OUT',
        productId: item.productId,
        inventoryItemId: item.inventoryItemId || item.productId,
        itemName: item.name,
        category: item.category,
        quantity: item.quantity,
        quantityDelta: -item.quantity,
        unitCost: item.unitCost,
        totalCost: item.totalCost,
        costKnown: item.costKnown,
        recipientName: cleanRecipientName,
        businessDate: resolvedBusinessDate,
        operationalDayId: text(operationalDayId),
        shiftId: text(shiftId),
        shiftType: text(shiftType),
        createdBy: text(createdBy || cashierName || cashierId),
        createdAt: resolvedTimestamp,
        salesImpact: 0,
        discountImpact: 0,
        revenueImpact: 0,
        cashImpact: 0,
        expenseImpact: 0
      }
    })

  return {
    id: recordId,
    type: normalizedType,
    typeLabel: meta.label,
    movementType,
    recipientName: cleanRecipientName,
    items: normalizedItems,
    totalQuantity,
    totalKnownCost,
    cost: totalKnownCost,
    anyCostKnown,
    allCostsKnown,
    // Explicit financial isolation guarantees (Sections 4, 5, 6, 7, 16):
    customerPaid: 0,
    salesImpact: 0,
    discountImpact: 0,
    revenueImpact: 0,
    cashImpact: 0,
    expenseImpact: 0,
    isSale: false,
    isDiscount: false,
    isPayment: false,
    isRevenue: false,
    isCashExpense: false,
    businessDate: resolvedBusinessDate,
    operationalDayId: text(operationalDayId),
    shiftId: text(shiftId),
    shiftType: text(shiftType),
    shiftLabel: text(shiftLabel),
    cashierId: text(cashierId),
    cashierName: text(cashierName || createdBy),
    createdBy: text(createdBy || cashierName || cashierId),
    note: text(note),
    createdAt: resolvedTimestamp,
    status: 'completed',
    inventoryMovements
  }
}

export const recordFreeMaterial = (options = {}, { storage } = {}) => {
  const store = getStorage(storage || options?.storage)
  const existingInventory = readJsonList(store, INVENTORY_ITEMS_STORAGE_KEY)
  const mergedInventoryItems = Array.isArray(options.inventoryItems) && options.inventoryItems.length > 0
    ? options.inventoryItems
    : existingInventory

  const record = createFreeMaterialRecord({
    ...options,
    inventoryItems: mergedInventoryItems
  })

  // 1. Save Free Material Consumption record in its dedicated store (never in sales or expenses)
  const existingRecords = readJsonList(store, FREE_MATERIAL_STORAGE_KEY)
  const updatedRecords = [
    ...existingRecords.filter(r => text(r?.id) !== record.id),
    record
  ]
  writeJsonList(store, FREE_MATERIAL_STORAGE_KEY, updatedRecords)

  // 2. Save Inventory Outflow movements (GIFT / HOSPITALITY / LOYALTY) and update tracked stock if present
  const existingMovements = readJsonList(store, INVENTORY_MOVEMENTS_STORAGE_KEY)
  const updatedMovements = [
    ...existingMovements.filter(m => text(m?.freeMaterialId) !== record.id),
    ...record.inventoryMovements
  ]
  writeJsonList(store, INVENTORY_MOVEMENTS_STORAGE_KEY, updatedMovements)

  if (Array.isArray(mergedInventoryItems) && mergedInventoryItems.length > 0 && record.inventoryMovements.length > 0) {
    const updatedList = mergedInventoryItems.map(item => ({ ...item }))
    for (const mov of record.inventoryMovements) {
      const target = updatedList.find(
        item =>
          (text(mov.inventoryItemId) && (text(item.id) === text(mov.inventoryItemId) || text(item.inventoryItemId) === text(mov.inventoryItemId) || text(item.productId) === text(mov.inventoryItemId))) ||
          (text(mov.productId) && (text(item.productId) === text(mov.productId) || text(item.id) === text(mov.productId)))
      )
      if (target) {
        const beforeStock = Number.isFinite(Number(target.stock ?? target.quantity))
          ? Number(target.stock ?? target.quantity)
          : 0
        const afterStock = beforeStock - mov.quantity
        target.stock = afterStock
        target.quantity = afterStock
        target.lastMovementType = mov.movementType
        target.lastMovementAt = mov.createdAt
      }
    }
    writeJsonList(store, INVENTORY_ITEMS_STORAGE_KEY, updatedList)
  }

  return {
    record,
    inventoryMovements: record.inventoryMovements,
    inventoryStock: readJsonList(store, INVENTORY_ITEMS_STORAGE_KEY)
  }
}

export const readLocalFreeMaterials = ({ storage } = {}) =>
  readJsonList(storage, FREE_MATERIAL_STORAGE_KEY)

export const readLocalInventoryMovements = ({ storage } = {}) =>
  readJsonList(storage, INVENTORY_MOVEMENTS_STORAGE_KEY)

export const readLocalInventoryItems = ({ storage } = {}) =>
  readJsonList(storage, INVENTORY_ITEMS_STORAGE_KEY)

export const mergeFreeMaterialsCollections = (centralRecords = [], localRecords = []) => {
  const merged = new Map()
  for (const row of Array.isArray(localRecords) ? localRecords : []) {
    const id = text(row?.id)
    if (id && row?.status !== 'voided' && !row?.voided) {
      merged.set(id, row)
    }
  }
  for (const row of Array.isArray(centralRecords) ? centralRecords : []) {
    const id = text(row?.id)
    if (id && row?.status !== 'voided' && !row?.voided) {
      merged.set(id, row)
    }
  }
  return [...merged.values()].sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
}

export const filterFreeMaterialsByPeriod = (records = [], { from = '', to = '', operationalDayId = '' } = {}) => {
  const cleanFrom = normalizeDateKey(from)
  const cleanTo = normalizeDateKey(to)
  const cleanDayId = text(operationalDayId)

  return (Array.isArray(records) ? records : []).filter(record => {
    if (!record || record.voided || record.status === 'voided') return false
    if (cleanDayId && text(record.operationalDayId) && text(record.operationalDayId) === cleanDayId) {
      return true
    }
    const recordDate = normalizeDateKey(record.businessDate) || getLocalDateKey(record.createdAt)
    if (cleanFrom && recordDate < cleanFrom) return false
    if (cleanTo && recordDate > cleanTo) return false
    return true
  })
}

const buildTypeSection = (typeKey, records = []) => {
  const meta = FREE_MATERIAL_TYPES[typeKey]
  const matching = records.filter(r => normalizeFreeMaterialType(r?.type) === typeKey)
  const itemsByKey = new Map()
  const operations = []

  let totalQuantity = 0
  let totalKnownCost = 0
  let knownCostItemsCount = 0
  let unknownCostItemsCount = 0

  for (const record of matching) {
    const rawItems = Array.isArray(record?.items) ? record.items : Object.values(record?.items || {})
    const normalizedItems = rawItems.map(item => {
      const quantity = positiveQuantity(item?.quantity)
      const unitCost = (item?.costKnown === true || (item?.unitCost !== null && item?.unitCost !== undefined && Number(item?.unitCost) > 0))
        ? Number(item.unitCost ?? (Number(item.totalCost || item.cost) / (quantity || 1)))
        : null
      const costKnown = unitCost !== null && Number.isFinite(unitCost) && unitCost > 0
      const itemTotalCost = costKnown ? Math.round(unitCost * quantity * 100) / 100 : null

      totalQuantity += quantity
      if (costKnown) {
        totalKnownCost += itemTotalCost
        knownCostItemsCount += 1
      } else {
        unknownCostItemsCount += 1
      }

      const aggKey = `${text(item?.productId || item?.name)}::${costKnown ? unitCost : 'unknown'}`
      const existing = itemsByKey.get(aggKey) || {
        productId: text(item?.productId || item?.name),
        name: text(item?.name),
        category: text(item?.category || 'عام'),
        quantity: 0,
        unitCost: costKnown ? unitCost : null,
        totalCost: costKnown ? 0 : null,
        costKnown
      }
      existing.quantity += quantity
      if (costKnown) {
        existing.totalCost = Math.round((existing.totalCost + itemTotalCost) * 100) / 100
        existing.knownTotalCost = existing.totalCost
      }
      itemsByKey.set(aggKey, existing)

      return {
        productId: text(item?.productId || item?.name),
        name: text(item?.name),
        category: text(item?.category || 'عام'),
        quantity,
        unitCost: costKnown ? unitCost : null,
        totalCost: itemTotalCost,
        knownTotalCost: itemTotalCost,
        costKnown
      }
    })

    const opKnownItems = normalizedItems.filter(i => i.costKnown)
    const opKnownCost = opKnownItems.length > 0
      ? opKnownItems.reduce((s, i) => s + i.totalCost, 0)
      : null

    operations.push({
      id: text(record.id),
      type: typeKey,
      typeLabel: meta.label,
      movementType: meta.movementType,
      recipientName: text(record.recipientName),
      businessDate: normalizeDateKey(record.businessDate) || getLocalDateKey(record.createdAt),
      createdAt: Number(record.createdAt || 0),
      cashierName: text(record.cashierName || record.createdBy),
      note: text(record.note),
      items: normalizedItems,
      totalQuantity: normalizedItems.reduce((s, i) => s + i.quantity, 0),
      totalKnownCost: opKnownCost,
      knownTotalCost: opKnownCost,
      totalCost: opKnownCost,
      costKnown: opKnownItems.length > 0
    })
  }

  const materialsList = [...itemsByKey.values()]
  const resolvedTotalKnownCost = knownCostItemsCount > 0 ? totalKnownCost : null

  return {
    type: typeKey,
    label: meta.label,
    sectionTitle: meta.sectionTitle,
    movementType: meta.movementType,
    operationsCount: operations.length,
    operations,
    byRecipient: operations,
    materials: materialsList,
    items: materialsList,
    totalQuantity,
    totalKnownCost: resolvedTotalKnownCost,
    knownTotalCost: resolvedTotalKnownCost || 0,
    hasKnownCost: knownCostItemsCount > 0,
    knownCostItemsCount,
    unknownCostItemsCount
  }
}

export const buildFreeMaterialsReport = ({
  records = [],
  centralRecords = [],
  localRecords = [],
  from = '',
  to = '',
  operationalDayId = ''
} = {}) => {
  const baseRecords = Array.isArray(records) && records.length > 0
    ? records
    : mergeFreeMaterialsCollections(centralRecords, localRecords)

  const filtered = filterFreeMaterialsByPeriod(baseRecords, { from, to, operationalDayId })

  const gift = buildTypeSection('gift', filtered)
  const hospitality = buildTypeSection('hospitality', filtered)
  const loyalty = buildTypeSection('loyalty', filtered)

  const totalOperations = gift.operationsCount + hospitality.operationsCount + loyalty.operationsCount
  const totalQuantity = gift.totalQuantity + hospitality.totalQuantity + loyalty.totalQuantity
  const hasAnyKnownCost = gift.hasKnownCost || hospitality.hasKnownCost || loyalty.hasKnownCost
  const totalKnownCost = hasAnyKnownCost
    ? (Number(gift.totalKnownCost || 0) + Number(hospitality.totalKnownCost || 0) + Number(loyalty.totalKnownCost || 0))
    : null

  const summary = {
    operationsCount: totalOperations,
    totalOperations,
    totalQuantity,
    totalKnownCost,
    knownTotalCost: totalKnownCost || 0,
    hasAnyKnownCost,
    // Financial safety confirmation:
    salesImpact: 0,
    discountImpact: 0,
    revenueImpact: 0,
    cashImpact: 0,
    expenseImpact: 0
  }

  return {
    from: normalizeDateKey(from),
    to: normalizeDateKey(to),
    gift,
    hospitality,
    loyalty,
    sections: [gift, hospitality, loyalty],
    summary,
    totals: summary
  }
}
