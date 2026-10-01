import React, { useMemo, useState } from 'react'
import { Icon } from './Icons'
import { formatMoney, formatNumber } from '../utils.js'
import { categoryId, productNames } from '../data/menu'

const fallbackImage = `${import.meta.env.BASE_URL}assets/branding/101-logo-transparent.png`
const emptyForm = { id: '', name: '', english: '', category: '', price: '', image: '', enabled: true, productType: 'parent', parentProductId: '' }

const prepareProductImage = file => new Promise((resolve, reject) => {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    reject(new Error('اختر صورة JPG أو JPEG أو PNG أو WEBP.'))
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    reject(new Error('حجم الصورة الأصلي يجب ألا يتجاوز 10MB.'))
    return
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    URL.revokeObjectURL(url)
    const maxSide = 900
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    let quality = .82
    let dataUrl = canvas.toDataURL('image/webp', quality)
    while (dataUrl.length > 700000 && quality > .5) {
      quality -= .08
      dataUrl = canvas.toDataURL('image/webp', quality)
    }
    if (dataUrl.length > 700000) reject(new Error('تعذر تقليل الصورة إلى حجم آمن للحفظ المركزي.'))
    else resolve(dataUrl)
  }
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة.')) }
  image.src = url
})

function ProductImage({ product, className = '' }) {
  const [src, setSrc] = useState(product?.image || fallbackImage)
  return <img className={className} src={src} alt="" onError={() => setSrc(fallbackImage)} />
}

function ProductForm({ product, products, categories, onClose, onSave }) {
  const [form, setForm] = useState(() => product
    ? { ...emptyForm, ...product, productType: product.parentProductId ? 'child' : 'parent', price: String(product.price ?? '') }
    : { ...emptyForm, category: categories[0] || '' })
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(form.image || fallbackImage)
  const [busy, setBusy] = useState(false)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const chooseImage = event => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('اختر صورة JPG أو JPEG أو PNG أو WEBP.'); return }
    prepareProductImage(file).then(dataUrl => { set('image', dataUrl); setPreview(dataUrl); setError('') }).catch(error => setError(error.message))
  }
  const submit = async event => {
    event.preventDefault()
    const name = String(form.name || '').trim()
    const price = Number(form.price)
    if (!name) { setError('اسم المنتج مطلوب.'); return }
    if (!Number.isFinite(price) || price < 0) { setError('السعر يجب أن يكون رقماً لا يقل عن صفر.'); return }
    if (form.productType === 'child' && !form.parentProductId) { setError('اختر المنتج الرئيسي أولاً.'); return }
    const parent = products.find(item => String(item.id) === String(form.parentProductId))
    if (form.productType === 'child' && (!parent || parent.parentProductId)) { setError('المنتج الرئيسي غير صالح.'); return }
    setBusy(true); setError('')
    try {
      await onSave({
        ...form,
        name,
        price,
        productType: form.productType === 'child' ? 'child' : 'parent',
        parentProductId: form.productType === 'child' ? String(form.parentProductId) : '',
        category: form.productType === 'child' ? parent.category : form.category,
        categoryId: form.productType === 'child' ? (parent.categoryId || categoryId(parent.category)) : categoryId(form.category),
        enabled: form.enabled !== false,
      })
      onClose()
    }
    catch (saveError) { setError(saveError?.message || 'تعذر حفظ المنتج.') }
    finally { setBusy(false) }
  }
  return <div className="overlay" role="dialog" aria-modal="true">
    <form className="dialog product-form-dialog" dir="rtl" onSubmit={submit}>
      <button type="button" className="close" onClick={onClose} aria-label="إغلاق"><Icon name="x" /></button>
      <div className="dialog-heading"><h2>{product ? 'تعديل المنتج' : 'إضافة منتج'}</h2><p>تُحفظ التغييرات في كتالوج المنتجات المركزي.</p></div>
      <fieldset className="product-type-fieldset">
        <legend>نوع المنتج</legend>
        <label><input type="radio" name="productType" value="parent" checked={form.productType !== 'child'} onChange={() => set('productType', 'parent')} /> منتج رئيسي / عادي</label>
        <label><input type="radio" name="productType" value="child" checked={form.productType === 'child'} onChange={() => set('productType', 'child')} /> منتج فرعي</label>
      </fieldset>
      <div className="product-form-grid">
        <label>{form.productType === 'child' ? 'اسم المنتج الفرعي *' : 'اسم المنتج *'}<input autoFocus value={form.name} onChange={e => set('name', e.target.value)} /></label>
        <label>الاسم بالإنجليزية<input value={form.english || ''} onChange={e => set('english', e.target.value)} /></label>
        {form.productType === 'child' ? <label>المنتج الرئيسي *<select value={form.parentProductId || ''} onChange={e => set('parentProductId', e.target.value)}><option value="">اختر المنتج الرئيسي</option>{products.filter(item => !item.parentProductId && String(item.id) !== String(product?.id)).map(item => <option key={item.id} value={item.id}>{productNames(item).arabic || item.name}</option>)}</select><small className="product-form-hint">سيُحفظ المنتج الفرعي داخل قسم المنتج الرئيسي.</small></label> : <label>القسم *<select value={form.category} onChange={e => set('category', e.target.value)}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>}
        <label>السعر (د.ع) *<input dir="ltr" type="number" min="0" step="1" value={form.price} onChange={e => set('price', e.target.value)} /></label>
      </div>
      <label className="product-image-picker">صورة المنتج<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={chooseImage} /><span>اختيار صورة من الجهاز</span></label>
      <div className="product-image-preview"><img src={preview} alt="معاينة صورة المنتج" onError={e => { e.currentTarget.src = fallbackImage }} /><span>معاينة قبل الحفظ</span></div>
      <label className="product-enabled-toggle"><input type="checkbox" checked={form.enabled !== false} onChange={e => set('enabled', e.target.checked)} /> المنتج ظاهر للكاشير</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-action" onClick={onClose}>إلغاء</button><button className="primary-action" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button></div>
    </form>
  </div>
}

export default function Settings({ products, categories, canWrite, onSave, onNavigate, discountPresets = { baly: 26, toters: 25 }, onSaveDiscountPresets }) {
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const [discountForm, setDiscountForm] = useState(() => ({ baly: String(discountPresets.baly), toters: String(discountPresets.toters) }))
  const sorted = useMemo(() => products.slice().sort((a, b) => Number(b.enabled !== false) - Number(a.enabled !== false) || String(a.name).localeCompare(String(b.name), 'ar')), [products])
  const save = async product => { await onSave(product); setNotice('تم حفظ المنتج وتحديث الكاشير عند اتصاله.'); window.setTimeout(() => setNotice(''), 4000) }
  const toggle = product => save({ ...product, enabled: product.enabled === false }).catch(error => setNotice(error?.message || 'تعذر حفظ حالة المنتج.'))
  const saveDiscounts = event => {
    event.preventDefault()
    const next = { baly: Number(discountForm.baly), toters: Number(discountForm.toters) }
    if (![next.baly, next.toters].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      setNotice('يجب أن تكون خصومات بلي وتوترز بين 0 و100.')
      return
    }
    onSaveDiscountPresets?.(next)
    setNotice('تم حفظ خصومات بلي وتوترز على جهاز الكاشير.')
    window.setTimeout(() => setNotice(''), 4000)
  }
  return <section className="settings-page" dir="rtl">
    <div className="settings-heading"><div><button type="button" className="back-link" onClick={() => onNavigate('dashboard')}><Icon name="arrow" size={18} /> الرئيسية</button><h1>الإعدادات</h1><p>إدارة المنتجات فقط</p></div><span className="settings-lock">{canWrite ? 'إدارة مصرح بها' : 'قراءة فقط'}</span></div>
    <section className="settings-card"><div className="settings-card-heading"><div><h2>إدارة المنتجات</h2><p>{formatNumber(products.length)} منتج — الإخفاء لا يحذف المنتج أو المبيعات السابقة.</p></div><button type="button" className="primary-action" disabled={!canWrite} onClick={() => setEditing({})}><Icon name="plus" size={18} /> إضافة منتج</button></div>
      {!canWrite && <p className="settings-readonly" role="status">تسجيل دخول حساب POS مصرح به مطلوب لإضافة أو تعديل المنتجات.</p>}
      <div className="settings-product-list">{sorted.map(product => { const names = productNames(product); const hidden = product.enabled === false; const parent = products.find(item => String(item.id) === String(product.parentProductId)); return <article className={`settings-product-row ${hidden ? 'is-hidden' : ''}`} key={product.id}>
        <ProductImage product={product} className="settings-product-image" /><div className="settings-product-info"><h3>{product.parentProductId ? '↳ ' : ''}{names.arabic || product.name}</h3><p>{product.parentProductId ? `تابع لـ ${parent ? productNames(parent).arabic : 'منتج رئيسي'}` : (product.category || 'غير مصنف')} · <span dir="ltr">{formatMoney(product.price)}</span></p></div><span className={`product-status ${hidden ? 'hidden' : 'visible'}`}>{hidden ? 'مخفي' : 'ظاهر'}</span><div className="settings-product-actions"><button type="button" disabled={!canWrite} onClick={() => setEditing(product)}>تعديل</button><button type="button" disabled={!canWrite} onClick={() => toggle(product)}>{hidden ? 'إظهار' : 'إخفاء'}</button></div>
      </article> })}</div>
    </section>
    <form className="settings-card cashier-discounts-card" onSubmit={saveDiscounts}>
      <div className="settings-card-heading"><div><h2>خصومات بلي وتوترز</h2><p>تُحفظ محلياً على جهاز الكاشير ولا تغيّر المبيعات السابقة.</p></div></div>
      <div className="discount-presets-grid">
        <label>خصم بلي (%)<input type="number" min="0" max="100" step="1" value={discountForm.baly} onChange={e => setDiscountForm(v => ({ ...v, baly: e.target.value }))} /></label>
        <label>خصم توترز (%)<input type="number" min="0" max="100" step="1" value={discountForm.toters} onChange={e => setDiscountForm(v => ({ ...v, toters: e.target.value }))} /></label>
      </div>
      <button className="primary-action" type="submit">حفظ الخصومات</button>
    </form>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {editing && <ProductForm product={editing.id ? editing : null} products={products} categories={categories} onClose={() => setEditing(null)} onSave={save} />}
  </section>
}
