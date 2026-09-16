import { Icon } from './Icons'

const productMarks = {
  'قهوة مختصة': 'V',
  'قهوة ساخنة': '☕',
  'مشروبات باردة': '❄',
  'مشروبات 101': '١٠١',
  'حلويات': '◒',
  'ساندويتشات': '—',
  'إضافات/أخرى': '+'
}

export default function ProductGrid({
  products, category, setCategory,
  categories, query, setQuery, onSelect
}) {
  return (
    <section className="catalog">

      {/* Toolbar: search */}
      {categories.length > 0 && (
        <div className="catalog-toolbar">
          <label className="search">
            <Icon name="search" size={17} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="إبحث عن منتج..."
            />
          </label>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
            {products.length} منتج
          </span>
        </div>
      )}

      {/* Category tabs */}
      {categories.length > 0 && (
        <nav className="category-tabs" aria-label="الأقسام">
          {categories.map(cat => (
            <button
              key={cat}
              className={category === cat ? 'selected' : ''}
              onClick={() => setCategory(cat)}
            >
              {cat === 'الكل' && <Icon name="grid" size={15} />}
              {cat}
            </button>
          ))}
        </nav>
      )}

      {/* Products scroll area */}
      <div className="products-area">
        <div className="product-grid">
          {products.map(product => (
            <button
              className={`product-card ${product.unavailable ? 'unavailable' : ''}`}
              key={product.id}
              onClick={() => !product.unavailable && onSelect(product)}
              disabled={product.unavailable}
            >
              <div className={`product-image shade-${product.id % 5}`}>
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                ) : (
                  <span>{productMarks[product.category] || '☕'}</span>
                )}
                {product.favorite && (
                  <i className="fav"><Icon name="star" size={12} /></i>
                )}
                {product.unavailable && <em>غير متوفر</em>}
              </div>
              <div className="product-info">
                <b>{product.name}</b>
                <small>{product.english}</small>
                <strong>
                  {product.price ? `${product.price.toLocaleString('ar-IQ')} د.ع` : 'قريبًا'}
                </strong>
              </div>
            </button>
          ))}
        </div>

        {!products.length && (
          <div className="empty">
            <Icon name="search" size={26} />
            <b>لم يتم العثور على منتج</b>
            <span>جرّب كتابة اسم مختلف</span>
          </div>
        )}
      </div>
    </section>
  )
}
