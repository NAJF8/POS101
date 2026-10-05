const categoryId = value => {
  const key = String(value || '').trim().replace(/\s+/g, '')
  return { ساندويش: 'ساندويتشات', ساندويشات: 'ساندويتشات', ساندويتش: 'ساندويتشات' }[key] || key
}

const firstValue = (...values) => values.find(value => String(value ?? '').trim()) || ''
const productKey = value => String(value ?? '').trim()

const categoryFromRecord = record => firstValue(record?.categoryId, record?.category_id, record?.category)

const resolveProduct = (item, productsById) => {
  const directId = firstValue(item?.productId, item?.product_id, item?.childProductId, item?.variantId, item?.id)
  const direct = directId ? productsById.get(productKey(directId)) : null
  if (direct) return direct
  const parentId = firstValue(item?.parentProductId, item?.parent_product_id)
  return parentId ? productsById.get(productKey(parentId)) || null : null
}

const resolveCategory = (item, productsById) => {
  const itemCategory = categoryFromRecord(item)
  if (itemCategory) return itemCategory

  let product = resolveProduct(item, productsById)
  const visited = new Set()
  while (product && !categoryFromRecord(product)) {
    const id = productKey(product.id)
    if (!id || visited.has(id)) break
    visited.add(id)
    const parentId = firstValue(product.parentProductId, product.parent_product_id)
    product = parentId ? productsById.get(productKey(parentId)) || null : null
  }
  return categoryFromRecord(product)
}

export const buildMaterialsReport = ({ sales = [], products = [], categories = [] } = {}) => {
  const productsById = new Map((Array.isArray(products) ? products : []).map(product => [productKey(product?.id), product]))
  const orderedCategories = []
  const categoryLabels = new Map()
  const addCategory = value => {
    const raw = String(value ?? '').trim()
    const normalized = categoryId(raw)
    if (!raw || normalized === categoryId('الكل') || categoryLabels.has(normalized)) return
    categoryLabels.set(normalized, raw)
    orderedCategories.push(normalized)
  }

  ;(Array.isArray(categories) ? categories : []).forEach(addCategory)
  ;(Array.isArray(products) ? products : []).forEach(product => addCategory(categoryFromRecord(product)))

  const groups = new Map()
  let grandQuantity = 0
  let grandTotal = 0
  ;(Array.isArray(sales) ? sales : []).forEach(sale => {
    const items = sale?.items || sale?.order?.items || []
    ;(Array.isArray(items) ? items : Object.values(items || {})).forEach(item => {
      const quantity = Number(item?.quantity || 0)
      const total = quantity * Number(item?.price ?? item?.unitPrice ?? 0)
      if (!Number.isFinite(quantity) || !Number.isFinite(total) || quantity <= 0) return
      const category = resolveCategory(item, productsById)
      const normalized = categoryId(category || 'غير مصنف')
      if (!categoryLabels.has(normalized)) {
        categoryLabels.set(normalized, category || 'غير مصنف')
        orderedCategories.push(normalized)
      }
      const group = groups.get(normalized) || { id: normalized, name: categoryLabels.get(normalized), items: new Map(), quantity: 0, total: 0 }
      const name = String(item?.displayName || item?.name || 'مادة غير معرّفة').trim() || 'مادة غير معرّفة'
      const row = group.items.get(name) || { name, quantity: 0, total: 0 }
      row.quantity += quantity
      row.total += total
      group.items.set(name, row)
      group.quantity += quantity
      group.total += total
      grandQuantity += quantity
      grandTotal += total
      groups.set(normalized, group)
    })
  })

  return {
    sections: orderedCategories
      .map(id => groups.get(id))
      .filter(Boolean)
      .map(section => ({ ...section, items: [...section.items.values()].sort((a, b) => b.quantity - a.quantity) })),
    grandQuantity,
    grandTotal,
  }
}
