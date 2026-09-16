import React from 'react'
import { Icon } from './Icons'

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
        <div className="options-product shade-1">☕</div>
        <div>
          <p>{product.category}</p>
          <h2>{product.name}</h2>
          <span>{format(product.price)}</span>
        </div>
      </div>
      <section>
        <h3>الحجم</h3>
        <div className="choice-row">
          {[['صغير', -500], ['عادي', 0], ['كبير', 1000]].map(([label, add]) => (
            <button key={label} onClick={() => setSize(label)} className={size === label ? 'active' : ''}>
              {label}
              <small>{add ? `${add > 0 ? '+' : ''}${format(add)}` : 'السعر الأساسي'}</small>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>الإضافات</h3>
        <div className="addon-list">
          {[['شوت إضافي', true], ['فانيلا', true], ['كراميل', true], ['حليب خالي اللاكتوز', false]].map(([name, isPaid]) => (
            <label key={name}>
              <input type="checkbox" checked={addons.some(x => x.name === name)} onChange={() => toggle(name, isPaid)} />
              <span>{name}</span>
              <b>{isPaid ? '+٥٠٠ د.ع' : 'مجاني'}</b>
            </label>
          ))}
        </div>
      </section>
      <section>
        <h3>ملاحظات خاصة</h3>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بدون سكر، ثلج قليل" />
      </section>
      <div className="dialog-footer">
        <div className="quantity">
          <button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Icon name="minus" size={15} /></button>
          <b>{quantity}</b>
          <button onClick={() => setQuantity(quantity + 1)}><Icon name="plus" size={15} /></button>
        </div>
        <button className="primary-action" onClick={() => onAdd({
          ...product, quantity, options: [size, ...addons.map(x => x.name)].join(' • '), notes,
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
  const [input, setInput] = React.useState(current?.input || 0)
  const raw = Number(input) || 0
  const value = Math.min(subtotal, kind === 'percent'
    ? Math.round(subtotal * Math.min(100, Math.max(0, raw)) / 100)
    : Math.max(0, raw)
  )
  return (
    <Dialog onClose={onClose} className="discount-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <h2>إضافة خصم</h2>
      <p style={{ color: 'var(--muted)', margin: '4px 0 16px', fontSize: 13 }}>اختر نوع الخصم وقيمته</p>
      <div className="payment-methods">
        <button className={kind === 'amount' ? 'chosen' : ''} onClick={() => setKind('amount')}>مبلغ ثابت</button>
        <button className={kind === 'percent' ? 'chosen' : ''} onClick={() => setKind('percent')}>نسبة مئوية</button>
      </div>
      <label className="discount-input">
        {kind === 'percent' ? 'النسبة %' : 'قيمة الخصم'}
        <input type="number" min="0" max={kind === 'percent' ? 100 : subtotal} value={input} onChange={e => setInput(e.target.value)} />
      </label>
      <div className="discount-preview">
        <span>المجموع الفرعي <b>{format(subtotal)}</b></span>
        <span>قيمة الخصم <b>{format(value)}</b></span>
        <strong>الإجمالي النهائي <b>{format(subtotal - value)}</b></strong>
      </div>
      <button className="primary-action" onClick={() => onApply({ kind, input: raw, value })}>تطبيق الخصم</button>
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
      <h2>الطلبات</h2>
      <div className="order-filters">
        <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>المفتوحة</button>
        <button className={tab === 'held' ? 'active' : ''} onClick={() => setTab('held')}>المعلقة</button>
        <button className={tab === 'completed' ? 'active' : ''} onClick={() => setTab('completed')}>المكتملة</button>
      </div>
      {list.map(o => (
        <button className="open-order" key={o.id} onClick={() => o.completed ? onHistory(o) : onSelect(o.id)}>
          <span>
            <b>{o.sale?.orderNumber ? `#${o.sale.orderNumber}` : o.name}</b>
            <small>{(o.originalItems || o.items).length} منتجات</small>
          </span>
          <span>
            {o.table ? `داخل الكوفي • طاولة ${o.table}` : o.orderType || 'غير محدد'}
            <b>{format(o.total || o.items.reduce((s, i) => s + i.price * i.quantity, 0))}</b>
          </span>
          <em className={o.held ? 'held' : ''}>{o.completed ? 'مكتمل' : o.held ? 'معلق' : 'مفتوح'}</em>
        </button>
      ))}
      {!list.length && <div className="empty"><b>لا توجد طلبات هنا</b></div>}
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
  const [reason, setReason] = React.useState('طلب غير صحيح')
  const selected = items.find(i => i.lineId === item)
  return (
    <Dialog onClose={onClose} className="return-dialog">
      <button className="close" onClick={onClose}><Icon name="x" /></button>
      <h2>إرجاع منتج</h2>
      <p style={{ color: 'var(--muted)', margin: '4px 0 12px', fontSize: 13 }}>
        سجّل Adjustment منفصلًا، دون حذف البيع الأصلي.
      </p>
      <select value={item} onChange={e => setItem(e.target.value)}>
        {items.map(i => (
          <option key={i.lineId} value={i.lineId}>{i.name} — {format(i.price)} × {i.quantity}</option>
        ))}
      </select>
      <label>
        سبب الإرجاع
        <textarea value={reason} onChange={e => setReason(e.target.value)} />
      </label>
      <div className="return-total">
        المبلغ المراد إرجاعه <b>{format(selected?.price || 0)}</b>
      </div>
      <button
        className="primary-action"
        disabled={!selected}
        onClick={() => onConfirm({ lineId: selected.lineId, product: selected.name, quantity: 1, amount: selected.price, reason })}
      >
        تأكيد الإرجاع
      </button>
    </Dialog>
  )
}

/* ── Receipt — display:none normally, shown only @media print ── */
export function Receipt({ sale }) {
  if (!sale) return null
  const logoUrl = `${import.meta.env.BASE_URL}assets/logo.jpg`
  return (
    <div className="receipt-sheet">
      {/* CENTERED LOGO WRAPPER */}
      <div className="receipt-logo-wrap">
        <img src={logoUrl} alt="101 COFFEE HOUSE" />
      </div>
      <p>{new Date(sale.createdAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</p>
      <hr />
      {sale.order.items.map(i => (
        <div className="receipt-line" key={i.lineId}>
          <span>{i.name} × {i.quantity}</span>
          <b>{format(i.price * i.quantity)}</b>
        </div>
      ))}
      <hr />
      <div className="receipt-total">
        الإجمالي <b>{format(sale.total)}</b>
      </div>
    </div>
  )
}

/* ── Cashier Login ── */
export function CashierLogin({ cashiers, onClose, onLogin }) {
  const [cashierId, setCashierId] = React.useState(cashiers[0]?.cashierId || '')
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState('')
  const logoUrl = `${import.meta.env.BASE_URL}assets/logo.jpg`

  const submit = e => {
    e.preventDefault()
    const cashier = cashiers.find(c => c.cashierId === cashierId && c.enabled && c.pin === pin)
    if (!cashier) { setError('رمز الدخول غير صحيح أو الحساب معطل'); return }
    onLogin(cashier)
  }

  return (
    <Dialog onClose={onClose} className="cashier-login">
      <img src={logoUrl} alt="101 COFFEE HOUSE" />
      <h2>دخول الكاشير</h2>
      <p>نموذج محلي مؤقت — سيستبدل بتحقق ACC-101 لاحقًا.</p>
      <form onSubmit={submit}>
        <label>
          الكاشير
          <select value={cashierId} onChange={e => setCashierId(e.target.value)}>
            {cashiers.filter(c => c.enabled).map(c => (
              <option key={c.cashierId} value={c.cashierId}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          رمز الدخول
          <input autoFocus type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-action" type="submit">دخول</button>
      </form>
    </Dialog>
  )
}

/* ── Cashier Menu ── */
export function CashierMenu({ session, onClose, onLogout }) {
  return (
    <Dialog onClose={onClose} className="cashier-menu">
      <h2>{session.cashierNameSnapshot}</h2>
      <p>الوردية مفتوحة منذ {new Date(session.openedAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</p>
      <button className="primary-action" onClick={onLogout}>إغلاق الوردية وتسجيل الخروج</button>
    </Dialog>
  )
}

/* ── Confirm Dialog ── */
export function ConfirmDialog({ title, message, onClose, onConfirm }) {
  return (
    <Dialog onClose={onClose} className="confirm-dialog">
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="confirm-actions">
        <button onClick={onClose}>رجوع</button>
        <button className="danger-button" onClick={onConfirm}>تأكيد</button>
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
