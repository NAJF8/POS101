import { useEffect, useRef } from 'react'
import { Icon } from './Icons'
import { productNames } from '../data/menu'

export default function OrderPanel({ 
  order, updateQuantity, removeItem, onEdit, 
  onContinue, onHold, onDiscount, onClear, 
  onPrintMenu, onReturn, disabled, scrollRequest
}) {
  const itemsAreaRef = useRef(null)
  const subtotal = order.items.reduce((s, i) => s + i.price * i.quantity, 0)
  const discountVal = order.discount?.value || 0
  const total = Math.max(0, subtotal - discountVal)

  useEffect(() => {
    const area = itemsAreaRef.current
    if (!area || !scrollRequest) return
    area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' })
  }, [scrollRequest])

  return (
    <section className="order-panel" inert={disabled || undefined}>
      {/* Top Header */}
      <div className="order-top">
        <div className="order-title">
          <small>الطلب الحالي</small>
          <h2>{order.name}</h2>
        </div>
      </div>

      {/* Cart Items Area */}
      <div className="order-items-wrapper">
        <div className="items-header">
          <span className="col-num">#</span>
          <span className="col-prod">المنتج</span>
          <span className="col-price">السعر</span>
          <span className="col-qty">الكمية</span>
          <span className="col-total">المجموع</span>
          <span className="col-actions"></span>
        </div>
        <div className="order-items" ref={itemsAreaRef}>
          {order.items.length === 0 ? (
            <div className="empty-cart">
              <Icon name="coffee" size={40} />
              <p>السلة فارغة</p>
            </div>
          ) : (
            order.items.map((item, index) => {
              const names = productNames(item)
              return <div key={item.lineId} className="cart-item">
                <div className="i-num">{index + 1}</div>
                <div className="i-prod">
                  <div className="i-prod-img">
                    {item.image ? <img src={item.image} alt={names.arabic} /> : <div className="no-img"></div>}
                  </div>
                  <div className="i-prod-text">
                    <b>{names.arabic}</b>
                    {item.options?.map((o, i) => <div className="opt" key={i}>+ {typeof o === 'string' ? o : o.name}</div>)}
                  </div>
                </div>
                <div className="i-price">
                  <span>{item.price != null ? item.price.toLocaleString() : '—'}</span>
                  {item.price != null && <small>د.ع</small>}
                </div>
                <div className="qty-ctrl">
                  <button onClick={() => updateQuantity(item.lineId, -1)}><Icon name="minus" size={14}/></button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.lineId, 1)}><Icon name="plus" size={14}/></button>
                </div>
                <div className="i-total">
                  <span>{(item.price * item.quantity).toLocaleString()}</span>
                  <small>د.ع</small>
                </div>
                <div className="i-actions">
                  <button className="edit-btn" onClick={() => onEdit(item)}><Icon name="edit" size={16} /></button>
                  <button className="del-btn" onClick={() => removeItem(item.lineId)}><Icon name="trash" size={16} /></button>
                </div>
              </div>
            })
          )}
        </div>
      </div>

      {/* Bottom Pinned Area */}
      <div className="order-bottom">
        <div className="discount-row">
          <button className="discount-btn" onClick={onDiscount}>
            <div className="discount-icon-circle">%</div>
            <span>إضافة خصم</span>
            <Icon name="arrow" className="down-chevron" size={16} />
          </button>
        </div>

        <div className="totals-box">
          <div className="total-line">
            <span className="label">المجموع الفرعي</span>
            <span>{subtotal.toLocaleString()} <small>د.ع</small></span>
          </div>
          <div className="total-line discount-val">
            <span className="label">الخصم</span>
            <span>{discountVal.toLocaleString()} <small>د.ع</small></span>
          </div>
          <div className="divider" />
          <div className="grand-total">
            <span className="label">الإجمالي</span>
            <span className="amount">{total.toLocaleString()} <small>د.ع</small></span>
          </div>
        </div>

        <div className="action-row main-actions">
          <button className="btn-print" onClick={onPrintMenu}>
            <Icon name="printer" size={20} />
            <span>طباعة</span>
          </button>
          <button className="btn-return" onClick={onReturn}>
            <Icon name="return" size={20} />
            <span>إرجاع بيع</span>
          </button>
          <button className="btn-sell" onClick={onContinue} disabled={!order.items.length}>
            <Icon name="check" size={20} className="sell-icon" />
            <span>بيع</span>
          </button>
        </div>

        <button className="btn-cancel-order" onClick={onClear} disabled={!order.items.length}>
          <Icon name="trash" size={18} />
          <span>إلغاء الطلب</span>
        </button>
      </div>
    </section>
  )
}
