import { Icon } from './Icons'

const format = value => `${Number(value || 0).toLocaleString('ar-IQ')} د.ع`

export default function OrderPanel({
  order, updateQuantity, removeItem,
  onContinue, onHold, onEdit,
  onDiscount, onClear, onPrintMenu, onReturn, disabled
}) {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const discount = order.discount?.value || 0
  const total = Math.max(0, subtotal - discount)

  return (
    <aside className="order-panel">

      {/* ── Cart Header ── */}
      <div className="order-top">
        <div className="order-top-left">
          <span className="eyebrow">الطلب الحالي</span>
          <h2>{order.table ? `داخل الكوفي • طاولة ${order.table}` : order.name}</h2>
        </div>
        <button className="icon-button" aria-label="خيارات الطلب">
          <span>•••</span>
        </button>
      </div>

      {/* ── Cart Items — ONLY this scrolls ── */}
      <div className="order-items">
        {order.items.length > 0 ? (
          order.items.map(item => (
            <article className="cart-item" key={item.lineId}>
              <div className="cart-row">
                <div className="cart-main">
                  <b>{item.name}</b>
                  {item.options && <small>{item.options}</small>}
                </div>
                <strong>{format(item.price * item.quantity)}</strong>
              </div>
              <div className="cart-row cart-actions">
                <div className="quantity">
                  <button onClick={() => updateQuantity(item.lineId, -1)} aria-label="تقليل الكمية">
                    <Icon name="minus" size={15} />
                  </button>
                  <b>{item.quantity}</b>
                  <button onClick={() => updateQuantity(item.lineId, 1)} aria-label="زيادة الكمية">
                    <Icon name="plus" size={15} />
                  </button>
                </div>
                <div>
                  <button className="mini-edit" onClick={() => onEdit(item)}>
                    <Icon name="edit" size={14} /> تعديل
                  </button>
                  <button className="mini-delete" onClick={() => removeItem(item.lineId)} aria-label="حذف">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="cart-empty">
            <div className="coffee-empty">
              <Icon name="coffee" size={28} />
            </div>
            <b>اختر منتجًا لبدء الطلب</b>
            <span>ستظهر تفاصيل الطلب هنا</span>
          </div>
        )}
      </div>

      {/* ── Cart Footer — NEVER scrolls, always visible ── */}
      <div className="order-bottom">

        {/* Discount */}
        <div className="cart-tools">
          <button
            className="discount"
            onClick={onDiscount}
            disabled={disabled || !order.items.length}
          >
            <Icon name="plus" size={15} />
            <span>إضافة خصم</span>
          </button>
        </div>

        {/* Totals */}
        <div className="totals">
          <span>المجموع الفرعي <b>{format(subtotal)}</b></span>
          <span>الخصم <b>{format(discount)}</b></span>
          <div>
            <strong>الإجمالي</strong>
            <b>{format(total)}</b>
          </div>
        </div>

        {/* Primary actions */}
        <div className="action-bar">
          <button
            className="primary-action"
            disabled={disabled || !order.items.length}
            onClick={onContinue}
          >
            بيع <Icon name="arrow" size={17} />
          </button>
          <button className="return-action" onClick={onReturn}>
            <Icon name="return" size={16} /> إرجاع بيع
          </button>
          <button className="print-action" onClick={onPrintMenu}>
            <Icon name="printer" size={16} /> طباعة
          </button>
        </div>

        {/* Cancel */}
        <button
          className="cancel-action"
          onClick={onClear}
          disabled={disabled || !order.items.length}
        >
          <Icon name="trash" size={15} /> إلغاء الطلب
        </button>

      </div>
    </aside>
  )
}
