import { Icon } from './Icons'
import { productNames } from '../data/menu'

export default function OrderPanel({ 
  order, updateQuantity, removeItem, onEdit, 
  onContinue, onHold, onDiscount, onClear, 
  onPrintMenu, onReturn, disabled 
}) {
  const subtotal = order.items.reduce((s, i) => s + i.price * i.quantity, 0)
  const discountVal = order.discount?.value || 0
  const total = Math.max(0, subtotal - discountVal)

  return (
    <section className="order-panel" inert={disabled || undefined}>
      {/* Top Header */}
      <div className="order-top">
        <div className="order-title">
          <small>الطلب الحالي</small>
          <h2>{order.name}</h2>
        </div>
        {order.table && <span className="table-badge">طاولة {order.table}</span>}
        {order.orderType && <span className="type-badge">{order.orderType}</span>}
      </div>

      {/* Cart Items Area */}
      <div className="order-items-wrapper">
        <div className="items-header">
          <span className="col-del"></span>
          <span className="col-total">المجموع</span>
          <span className="col-qty">الكمية</span>
          <span className="col-price">السعر</span>
          <span className="col-prod">المنتج</span>
          <span className="col-num">#</span>
        </div>
        <div className="order-items">
          {order.items.length === 0 ? (
            <div className="empty-cart">
              <Icon name="coffee" size={40} />
              <p>السلة فارغة</p>
            </div>
          ) : (
            order.items.map((item, index) => {
              const names = productNames(item)
              return <div key={item.lineId} className="cart-item">
                <button className="del-btn" onClick={() => removeItem(item.lineId)}>
                  <Icon name="trash" size={18} />
                </button>
                <div className="i-total">
                  <span>{(item.price * item.quantity).toLocaleString()}</span>
                  <small>د.ع</small>
                </div>
                <div className="qty-ctrl">
                  <button onClick={() => updateQuantity(item.lineId, -1)}><Icon name="minus" size={16}/></button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.lineId, 1)}><Icon name="plus" size={16}/></button>
                </div>
                <div className="i-price">
                  <span>{item.price != null ? item.price.toLocaleString() : '—'}</span>
                  {item.price != null && <small>د.ع</small>}
                </div>
                <div className="i-prod" onClick={() => item.configurable && onEdit(item)}>
                  <div className="i-prod-text">
                    <b>{names.arabic}</b>
                    {names.english && <small>{names.english}</small>}
                    {item.options?.map((o, i) => <div className="opt" key={i}>+ {o.name}</div>)}
                  </div>
                  <div className="i-prod-img">
                    {item.image ? <img src={item.image} alt={names.arabic} /> : <div className="no-img">١٠١</div>}
                  </div>
                </div>
                <div className="i-num">{index + 1}</div>
              </div>
            })
          )}
        </div>
      </div>

      {/* Bottom Pinned Area */}
      <div className="order-bottom">
        <div className="discount-row">
          <button className="discount-btn" onClick={onDiscount}>
            <Icon name="card" size={18} />
            <span>إضافة خصم</span>
            <span className="pct">%</span>
          </button>
        </div>

        <div className="totals-box">
          <div className="total-line">
            <span>{subtotal.toLocaleString()} <small>د.ع</small></span>
            <span>المجموع الفرعي</span>
          </div>
          <div className="total-line discount-val">
            <span>{discountVal > 0 ? `-${discountVal.toLocaleString()}` : '0'} <small>د.ع</small></span>
            <span>الخصم</span>
          </div>
          <div className="divider" />
          <div className="grand-total">
            <span className="amount">{total.toLocaleString()} <small>د.ع</small></span>
            <span className="label">الإجمالي</span>
          </div>
        </div>

        <div className="action-row main-actions">
          <button className="btn-print" onClick={onPrintMenu}>
            <Icon name="printer" size={24} />
            <span>طباعة</span>
          </button>
          <button className="btn-return" onClick={onReturn}>
            <Icon name="return" size={20} />
            <span>إرجاع بيع</span>
          </button>
          <button className="btn-sell" onClick={onContinue} disabled={!order.items.length}>
            <span>بيع</span>
            <Icon name="arrow" size={24} />
          </button>
        </div>

        <button className="btn-cancel-order" onClick={onClear} disabled={!order.items.length}>
          <Icon name="trash" size={20} />
          <span>إلغاء الطلب</span>
        </button>
      </div>
    </section>
  )
}
