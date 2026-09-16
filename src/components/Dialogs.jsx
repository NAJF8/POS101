import React from 'react'
import { Icon } from './Icons'
import { productNames } from '../data/menu'

const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`

/* ── Product Options ── */
export function ProductOptions({ product, onClose, onAdd }) {
  const [size, setSize] = React.useState('عادي')
  const [addons, setAddons] = React.useState([])
  const [quantity, setQuantity] = React.useState(1)
  const [notes, setNotes] = React.useState('')

  const paid = addons.filter(a => a.paid).length * 500
  const total = (product.price + (size === 'كبير' ? 1000 : size === 'صغير' ? -500 : 0) + paid) * quantity
  const toggle = (name, paid) => setAddons(v => v.some(x => x.name === name) ? v.filter(x => x.name !== name) : [...v, { name, paid }])

  return (
    <Dialog onClose={onClose} className="options-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <div className="options-hero">
        <div className="options-product">
          {product.image ? <img src={product.image} alt="" /> : <span>101</span>}
        </div>
        <div>
          <p>{product.category}</p>
          <h2>{productNames(product).arabic}</h2>
          <span>{format(product.price)}</span>
        </div>
      </div>
      <section>
        <h3>الحجم</h3>
        <div className="choice-row">
          {[['صغير', -500], ['عادي', 0], ['كبير', 1000]].map(([label, add]) => (
            <button key={label} onClick={() => setSize(label)} className={size === label ? 'active' : ''}>
              <strong>{label}</strong>
              <small>{add ? `${add > 0 ? '+' : ''}${format(add)}` : 'السعر الأساسي'}</small>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>الإضافات</h3>
        <div className="addon-list">
          {[['شوت إضافي', true], ['فانيلا', true], ['كراميل', true], ['حليب خالي اللاكتوز', false]].map(([name, isPaid]) => (
            <label className="addon-option" key={name}>
              <input type="checkbox" checked={addons.some(x => x.name === name)} onChange={() => toggle(name, isPaid)} />
              <span className="addon-name">{name}</span>
              <b>{isPaid ? '+500 د.ع' : 'مجاني'}</b>
            </label>
          ))}
        </div>
      </section>
      <section>
        <h3>ملاحظات خاصة</h3>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بدون سكر، ثلج قليل" />
      </section>
      <div className="dialog-footer">
        <span className="quantity-label">الكمية</span>
        <div className="quantity">
          <button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Icon name="minus" size={15} /></button>
          <b>{quantity}</b>
          <button onClick={() => setQuantity(quantity + 1)}><Icon name="plus" size={15} /></button>
        </div>
        <button className="primary-action" onClick={() => onAdd({
          ...product, quantity, options: [size, ...addons.map(x => x.name)], notes,
          unitPrice: product.price + (size === 'كبير' ? 1000 : size === 'صغير' ? -500 : 0) + paid
        })}>
          إضافة للطلب <b>{format(total)}</b>
        </button>
      </div>
    </Dialog>
  )
}

/* ── Order Type ── */
export function OrderType({ onClose, onChoose }) {
  const types = [['داخل الكوفي', 'table'], ['توصيل', 'delivery']]
  return (
    <Dialog onClose={onClose} className="type-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <h2>كيف ترغب باستلام الطلب؟</h2>
      <p>اختر نوع الطلب للمتابعة إلى الدفع</p>
      <div className="type-grid">
        {types.map(([label, icon]) => (
          <button onClick={() => onChoose(label)} key={label}>
            <span><Icon name={icon} size={27} /></span>
            <b>{label}</b>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

/* ── Table Selection ── */
export function TableSelection({ onClose, onChoose, orders = [] }) {
  const busy = new Set(orders.filter(o => o.table && !o.completed).map(o => o.table))
  return (
    <Dialog onClose={onClose} className="tables-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <h2>اختر الطاولة</h2>
      <p>الحالة مبنية على الطلبات المحلية الحالية</p>
      <div className="table-grid">
        {Array.from({ length: 12 }, (_, i) => {
          const occupied = busy.has(i + 1)
          return (
            <button disabled={occupied} className={occupied ? 'busy' : 'free'} onClick={() => onChoose(i + 1)} key={i}>
              <Icon name="table" size={25} />
              <b>{i + 1}</b>
              <small>{occupied ? 'مشغولة' : 'فارغة'}</small>
            </button>
          )
        })}
      </div>
      <div className="legend">
        <span className="free">فارغة</span>
        <span className="busy">مشغولة</span>
      </div>
    </Dialog>
  )
}

/* ── Payment ── */
export function Payment({ total, onClose, onSuccess }) {
  const [processing, setProcessing] = React.useState(false)
  const [error, setError] = React.useState('')
  const choose = method => {
    if (processing) return
    setProcessing(true)
    setError('')
    try {
      if (onSuccess({ method, received: 0, change: 0 }) === false) throw new Error('SALE_FAILED')
    } catch {
      setProcessing(false)
      setError('تعذر حفظ البيع. بقي الطلب الحالي كما هو، حاول مرة أخرى.')
    }
  }
  return (
    <Dialog onClose={onClose} className="payment-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <p>الإجمالي المطلوب</p>
      <h2>{format(total)}</h2>
      <div className="payment-methods">
        <button disabled={processing} onClick={() => choose('cash')}>
          <Icon name="coffee" size={26} /><b>{processing ? 'جارٍ التسجيل…' : 'نقدي'}</b>
        </button>
        <button disabled={processing} onClick={() => choose('electronic')}>
          <Icon name="card" size={26} /><b>إلكتروني</b>
        </button>
      </div>
      <p className="payment-hint">اختيار وسيلة الدفع يؤكد البيع مباشرةً.</p>
      {error && <div className="form-error">{error}</div>}
    </Dialog>
  )
}

/* ── Quick Cash (F7) ── */
const banknotes = [250, 500, 1000, 5000, 10000, 25000, 50000].map(value => ({
  value,
  image: `${import.meta.env.BASE_URL}assets/banknotes/iqd-${value}.jpg`
}))

export function QuickCash({ total, onClose, onSuccess }) {
  const [notes, setNotes] = React.useState([])
  const [processing, setProcessing] = React.useState(false)
  const amount = notes.reduce((a, b) => a + b, 0)
  const due = Math.max(0, total - amount)
  const sell = () => {
    if (amount < total || processing) return
    setProcessing(true)
    setTimeout(() => onSuccess({ method: 'cash', received: amount, change: amount - total }), 180)
  }
  return (
    <Dialog onClose={onClose} className="payment-dialog quick-cash-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <p>الدفع النقدي السريع</p>
      <h2>{format(total)}</h2>
      <div className="cash-summary">
        <span>المستلم</span>
        <b>{format(amount)}</b>
      </div>
      <div className="banknote-grid">
        {banknotes.map(({ value, image }) => (
          <button className="banknote" key={value} onClick={() => setNotes(v => [...v, value])}>
            <img src={image} alt={`ورقة ${format(value)}`} />
            <strong>{format(value)}</strong>
          </button>
        ))}
      </div>
      <div className="cash-tools">
        <button onClick={() => setNotes(v => v.slice(0, -1))} disabled={!notes.length}>تراجع عن آخر ورقة</button>
        <button onClick={() => setNotes([])}>مسح الكل</button>
      </div>
      <div className={`change ${amount < total ? 'due' : ''}`}>
        <span>{amount < total ? 'المتبقي' : 'الباقي'}</span>
        <b>{format(amount < total ? due : amount - total)}</b>
      </div>
      <button className="primary-action" disabled={amount < total || processing} onClick={sell}>
        {processing ? 'جارٍ التسجيل…' : 'بيع'} <Icon name="check" size={18} />
      </button>
    </Dialog>
  )
}

/* ── Discount Dialog ── */
export function DiscountDialog({ subtotal, current, onClose, onApply }) {
  const [kind, setKind] = React.useState(current?.kind || 'amount')
  const [input, setInput] = React.useState(current?.input ?? '')
  const isPreset = kind === 'baly' || kind === 'toters'
  const raw = Number(input)
  const inputIsNumber = input !== '' && Number.isFinite(raw)
  const inputTooLarge = kind === 'amount' ? raw > subtotal : raw > 100
  const invalid = !isPreset && (!inputIsNumber || raw < 0 || inputTooLarge)
  const percentage = kind === 'baly' ? 26 : kind === 'toters' ? 25 : Math.min(100, Math.max(0, raw || 0))
  const value = Math.min(subtotal, Math.max(0, Math.round(kind === 'amount' ? (raw || 0) : subtotal * percentage / 100)))
  const chooseKind = nextKind => {
    setKind(nextKind)
    if (nextKind === 'baly') setInput(26)
    if (nextKind === 'toters') setInput(25)
    if (nextKind === 'amount' || nextKind === 'percent') setInput(current?.kind === nextKind ? current.input : '')
  }
  const cards = [
    { kind: 'amount', title: 'مبلغ ثابت', note: 'أدخل مبلغ الخصم بالدينار' },
    { kind: 'percent', title: 'نسبة مئوية', note: 'أدخل نسبة الخصم بنفسك' },
    { kind: 'baly', title: 'بلي', note: 'خصم ثابت 26%' },
    { kind: 'toters', title: 'توترز', note: 'خصم ثابت 25%' }
  ]
  return (
    <Dialog onClose={onClose} className="discount-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <div className="dialog-heading">
        <h2>إضافة خصم</h2>
        <p>اختر نوع الخصم وقيمته</p>
      </div>
      <div className="discount-cards" role="group" aria-label="نوع الخصم">
        {cards.map(card => (
          <button key={card.kind} type="button" className={`discount-card ${kind === card.kind ? 'selected' : ''}`} aria-pressed={kind === card.kind} onClick={() => chooseKind(card.kind)}>
            <b>{card.title}</b>
            <small>{card.note}</small>
          </button>
        ))}
      </div>
      {!isPreset && (
        <label className="discount-input">
          <span>{kind === 'percent' ? 'النسبة المئوية' : 'قيمة الخصم'}</span>
          <div className="number-input-wrap">
            <input type="number" inputMode="decimal" min="0" max={kind === 'percent' ? 100 : subtotal} value={input} onChange={e => setInput(e.target.value)} placeholder={kind === 'percent' ? 'مثال: 10' : 'مثال: 3000'} />
            <b>{kind === 'percent' ? '%' : 'د.ع'}</b>
          </div>
          {invalid && <small className="discount-validation">{input === '' ? 'أدخل قيمة الخصم أولاً.' : raw < 0 ? 'لا يمكن أن تكون القيمة سالبة.' : inputTooLarge ? 'لا يمكن أن يتجاوز الخصم المجموع الفرعي.' : 'أدخل رقمًا صحيحًا.'}</small>}
        </label>
      )}
      <div className="discount-summary" aria-label="ملخص الخصم">
        <div><span>المجموع الفرعي</span><b dir="ltr">{format(subtotal)}</b></div>
        <div className="discount-summary-value"><span>قيمة الخصم</span><b dir="ltr">{format(value)}</b></div>
        <div className="discount-summary-total"><span>الإجمالي بعد الخصم</span><strong dir="ltr">{format(subtotal - value)}</strong></div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="secondary-action" onClick={onClose}>إلغاء</button>
        <button type="button" className="primary-action" disabled={invalid} onClick={() => onApply({ kind, input: isPreset ? percentage : raw, value })}>تطبيق الخصم</button>
      </div>
    </Dialog>
  )
}

/* ── Open Orders ── */
export function OpenOrders({ orders, onClose, onSelect, onHistory }) {
  const [tab, setTab] = React.useState('open')
  const list = orders.filter(o => tab === 'completed' ? o.completed : tab === 'held' ? o.held && !o.completed : !o.completed && !o.held)
  return (
    <Dialog onClose={onClose} className="open-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <div className="dialog-heading"><h2>الطلبات المفتوحة</h2><p>اختر طلبًا للاستكمال أو عرض تفاصيله.</p></div>
      <div className="order-filters">
        <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>المفتوحة</button>
        <button className={tab === 'held' ? 'active' : ''} onClick={() => setTab('held')}>المعلقة</button>
        <button className={tab === 'completed' ? 'active' : ''} onClick={() => setTab('completed')}>المكتملة</button>
      </div>
      <div className="open-orders-list">
        {list.map(o => {
          const items = o.originalItems || o.items
          const orderTotal = o.total || items.reduce((sum, item) => sum + item.price * item.quantity, 0)
          const type = o.table ? `داخل الكوفي — طاولة ${o.table}` : o.orderType || 'غير محدد'
          return <article className="open-order" key={o.id}>
            <div className="open-order-main"><b dir="ltr">{o.sale?.orderNumber ? `#${o.sale.orderNumber}` : o.name}</b><em className={o.held ? 'held' : ''}>{o.completed ? 'مكتمل' : o.held ? 'معلق' : 'مفتوح'}</em></div>
            <dl><div><dt>نوع الطلب</dt><dd>{type}</dd></div><div><dt>عدد الأصناف</dt><dd dir="ltr">{items.reduce((sum, item) => sum + item.quantity, 0)}</dd></div><div><dt>الإجمالي</dt><dd dir="ltr">{format(orderTotal)}</dd></div></dl>
            <button type="button" onClick={() => o.completed ? onHistory(o) : onSelect(o.id)}>{o.completed ? 'عرض التفاصيل' : 'استئناف الطلب'}</button>
          </article>
        })}
        {!list.length && <div className="empty"><b>لا توجد طلبات هنا</b><small>ستظهر الطلبات المحفوظة أو غير المكتملة هنا.</small></div>}
      </div>
    </Dialog>
  )
}

/* ── History ── */
export function History({ order, onClose, onReturn, onAdd, onPrint, onReprint }) {
  const adjustments = order?.adjustments || []
  const items = order?.originalItems || order?.items || []
  return (
    <Dialog onClose={onClose} className="history-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <p>فاتورة مكتملة <b>#{order?.sale?.orderNumber || '—'}</b></p>
      <h2>تفاصيل الطلب وسجل التعديلات</h2>
      <div className="history-lines">
        {items.map(i => (
          <div key={i.lineId}>
            <span>{i.name} × {i.quantity}</span>
            <b>{format(i.price * i.quantity)}</b>
          </div>
        ))}
      </div>
      <div className="timeline">
        <div key="sale">
          <i /><b>البيع</b>
          <span>{order?.sale?.payment?.method || 'نقدي'} — {format(order?.sale?.total)}</span>
        </div>
        {adjustments.map(a => (
          <div key={a.id}>
            <i /><b>{a.type === 'refund' ? 'إرجاع' : 'إضافة'}</b>
            <span>{a.product} × {a.quantity} — {format(a.amount)} {a.reason && `— ${a.reason}`}</span>
          </div>
        ))}
      </div>
      <div className="sensitive-actions">
        <button onClick={onAdd}>إضافة منتج</button>
        <button onClick={onReturn}>إرجاع منتج</button>
        <button onClick={onPrint}>طباعة</button>
        <button onClick={onReprint}>إعادة طباعة الفاتورة</button>
      </div>
    </Dialog>
  )
}

/* ── Return Dialog ── */
export function ReturnDialog({ order, onClose, onConfirm }) {
  const items = order?.originalItems || order?.items || []
  const [item, setItem] = React.useState(items[0]?.lineId || '')
  const [quantity, setQuantity] = React.useState(1)
  const [reason, setReason] = React.useState('طلب غير صحيح')
  const selected = items.find(i => i.lineId === item)
  const maxQuantity = selected?.quantity || 1
  const returnQuantity = Math.min(maxQuantity, Math.max(1, Number(quantity) || 1))
  const sale = order?.sale
  return (
    <Dialog onClose={onClose} className="return-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <div className="dialog-heading"><h2>إرجاع بيع</h2><p>يسجل الإرجاع كتعديل مستقل ولا يحذف البيع الأصلي.</p></div>
      <section className="return-original" aria-label="معلومات البيع الأصلي">
        <div className="section-title">البيع الأصلي</div>
        <div className="return-meta"><span>رقم الطلب <b dir="ltr">{sale?.orderNumber ? `#${sale.orderNumber}` : '—'}</b></span><span>التاريخ والوقت <b dir="ltr">{sale?.createdAt ? new Date(sale.createdAt).toLocaleString('ar-IQ') : 'غير متوفر'}</b></span></div>
        <div className="return-items">{items.map(i => <div key={i.lineId}><span>{i.name}</span><b dir="ltr">{i.quantity} × {format(i.price)}</b></div>)}</div>
      </section>
      <section className="return-controls" aria-label="تفاصيل الإرجاع">
        <div className="section-title">تفاصيل الإرجاع</div>
        <label><span>الصنف المراد إرجاعه</span><select value={item} onChange={e => { setItem(e.target.value); setQuantity(1) }}>{items.map(i => <option key={i.lineId} value={i.lineId}>{i.name}</option>)}</select></label>
        <div className="return-control-grid"><label><span>الكمية</span><input type="number" min="1" max={maxQuantity} value={quantity} onChange={e => setQuantity(e.target.value)} /></label><div className="return-total"><span>مبلغ الإرجاع</span><b dir="ltr">{format((selected?.price || 0) * returnQuantity)}</b></div></div>
        <label><span>سبب الإرجاع</span><textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
      </section>
      <div className="dialog-actions">
        <button type="button" className="secondary-action" onClick={onClose}>إلغاء</button>
        <button
          type="button"
          className="primary-action"
          disabled={!selected}
          onClick={() => onConfirm({ lineId: selected.lineId, product: selected.name, quantity: returnQuantity, amount: selected.price * returnQuantity, reason })}
        >
          تأكيد الإرجاع
        </button>
      </div>
    </Dialog>
  )
}

/* ── Receipt — display:none normally, shown only @media print ── */
export function Receipt({ sale }) {
  if (!sale) return null
  const logoUrl = `${import.meta.env.BASE_URL}assets/branding/logo-transparent.png`
  return (
    <div className="receipt-sheet">
      <div className="receipt-logo-wrap">
        <img className="receipt-logo" src={logoUrl} alt="101 COFFEE HOUSE" />
      </div>
      <p className="receipt-date" dir="rtl">{new Date(sale.createdAt).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <section className="receipt-items" dir="rtl"><div className="receipt-table-head"><span>الصنف</span><span>الكمية</span><span>السعر</span></div>{sale.order.items.map(i => (
        <div className="receipt-line" key={i.lineId}><span>{i.name}</span><b dir="ltr">{i.quantity}</b><b dir="ltr">{format(i.price * i.quantity)}</b></div>
      ))}</section>
      <div className="receipt-total">
        <span>الإجمالي</span><b dir="ltr">{format(sale.total)}</b>
      </div>
    </div>
  )
}

/* ── Shift Login ── */
export function ShiftLogin({ shifts, onClose, onLogin }) {
  const [shiftId, setShiftId] = React.useState(shifts[0]?.shiftId || '')
  const logoUrl = `${import.meta.env.BASE_URL}assets/branding/logo-transparent.png`

  const submit = e => {
    e.preventDefault()
    const shift = shifts.find(c => c.shiftId === shiftId)
    if (!shift) return
    onLogin(shift)
  }

  return (
    <Dialog onClose={onClose} className="cashier-login">
      <img src={logoUrl} alt="101 COFFEE HOUSE" style={{ maxHeight: '100px', objectFit: 'contain', marginBottom: '1rem' }} />
      <h2>اختيار الوردية</h2>
      <form onSubmit={submit}>
        <label>
          الوردية
          <select value={shiftId} onChange={e => setShiftId(e.target.value)}>
            {shifts.map(c => (
              <option key={c.shiftId} value={c.shiftId}>{c.name}</option>
            ))}
          </select>
        </label>
        <button className="primary-action" type="submit">دخول</button>
      </form>
    </Dialog>
  )
}

/* ── Seller Selection ── */
export function SellerSelection({ onClose, onSelect }) {
  const sellers = ['علي', 'روان', 'محمد', 'ميس']
  return (
    <Dialog onClose={onClose} className="type-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <h2>اختر اسم الكابتن</h2>
      <div className="type-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {sellers.map(name => (
          <button onClick={() => onSelect(name)} key={name}>
            <span><Icon name="user" size={27} /></span>
            <b>{name}</b>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

/* ── Cashier Menu ── */
export function CashierMenu({ session, onClose, onLogout }) {
  return (
    <Dialog onClose={onClose} className="cashier-menu">
      <h2>{session.shiftName}</h2>
      <p>الوردية مفتوحة منذ {new Date(session.openedAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</p>
      <button className="primary-action" onClick={onLogout}>إغلاق الوردية وتسجيل الخروج</button>
    </Dialog>
  )
}

/* ── Confirm Dialog ── */
export function ConfirmDialog({ title, message, onClose, onConfirm }) {
  const [confirming, setConfirming] = React.useState(false)
  const confirm = () => {
    if (confirming) return
    setConfirming(true)
    onConfirm()
  }
  return (
    <Dialog onClose={onClose} className="confirm-dialog">
      <div className="dialog-heading">
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      <div className="confirm-actions">
        <button type="button" onClick={onClose} disabled={confirming}>رجوع</button>
        <button type="button" className="danger-button" onClick={confirm} disabled={confirming}>
          {confirming ? 'جارٍ الإلغاء…' : 'تأكيد إلغاء الطلب'}
        </button>
      </div>
    </Dialog>
  )
}

/* ── Print Menu ── */
export function PrintMenu({ enabled, onClose, onChange }) {
  return (
    <Dialog onClose={onClose} className="print-menu">
      <h2>إعداد الطباعة</h2>
      <p>اختيار محفوظ على هذا الجهاز.</p>
      <button className={enabled ? 'selected' : ''} onClick={() => onChange(true)}>
        <b>تشغيل الطباعة</b>
        <small>تفتح الفاتورة تلقائيًا بعد نجاح البيع</small>
      </button>
      <button className={!enabled ? 'selected' : ''} onClick={() => onChange(false)}>
        <b>إيقاف الطباعة</b>
        <small>يستمر البيع دون فتح نافذة الطباعة</small>
      </button>
    </Dialog>
  )
}

/* ── Base Dialog ── */
function Dialog({ children, onClose, className = '' }) {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className={`dialog ${className}`}>{children}</div>
    </div>
  )
}
