import { Icon } from './Icons'
import { productNames } from '../data/menu'

// Mapping categories to icons
const getCategoryIcon = (category) => {
  switch (category) {
    case 'الكل': return 'grid';
    case 'قهوة مختصة': return 'coffee';
    case 'قهوة ساخنة': return 'hot';
    case 'مشروبات باردة': return 'cold';
    case 'مشروبات 101': return 'star';
    case 'حلويات': return 'cake';
    case 'ساندويتشات': return 'sandwich';
    case 'إضافات/أخرى': return 'plus';
    default: return 'grid';
  }
}

export default function ProductGrid({ 
  products, category, setCategory, categories, query, setQuery, onSelect,
  orders, activeOrderIndex, setActiveOrderIndex, onNewOrder, session
}) {
  return (
    <section className="catalog-panel">
      {/* Top Toolbar: Quick Orders + Search */}
      <div className="catalog-toolbar">
        {orders && (
          <div className="quick-orders">
            {orders.slice(0, 4).map((o, i) => (
              <button 
                onClick={() => session && setActiveOrderIndex(i)} 
                key={o.id} 
                className={activeOrderIndex === i ? 'active' : ''}
              >
                <span>طلب {o.id}</span>
                {o.table && <small>طاولة {o.table}</small>}
                {o.items.length > 0 && <i>{o.items.reduce((s, x) => s + x.quantity, 0)}</i>}
              </button>
            ))}
            <button className="quick-add" onClick={() => session && onNewOrder()} aria-label="فتح مساحة طلب جديدة">
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}

        <div className="search-box">
          <Icon name="search" />
          <input 
            type="search" 
            placeholder="ابحث عن منتج..." 
            value={query} 
            onChange={e => setQuery(e.target.value)} 
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="category-tabs">
        {categories.map(c => (
          <button 
            key={c} 
            className={`cat-btn ${category === c ? 'active' : ''}`} 
            onClick={() => setCategory(c)}
          >
            <Icon name={getCategoryIcon(c)} size={20} />
            <span>{c}</span>
          </button>
        ))}
      </div>

      {/* Products Area */}
      <div className="products-area">
        <div className="product-grid">
          {products.map(p => {
            const names = productNames(p)
            return <button key={p.id} className={`product-card ${p.unavailable ? 'unavailable' : ''}`} disabled={p.unavailable} onClick={() => onSelect(p)}>
              <div className="img-wrap">
                {p.image ? <img src={p.image} alt={names.arabic} loading="lazy" /> : <div className="no-img" aria-label="صورة 101 البديلة"><strong>101</strong><small>بدون صورة</small></div>}
                {p.category === 'مشروبات 101' && <span className="product-mark"><Icon name="star" size={12}/></span>}
              </div>
              <div className="p-info">
                <b className="p-name">{names.arabic}</b>
                {names.english && <small className="p-eng">{names.english}</small>}
                <div className="p-price">
                  <span>{p.price ? p.price.toLocaleString() : '—'}</span>
                  {p.price && <small>د.ع</small>}
                </div>
              </div>
            </button>
          })}
          {products.length === 0 && <div className="empty-state">لا يوجد منتجات تطابق البحث</div>}
        </div>
      </div>
    </section>
  )
}
