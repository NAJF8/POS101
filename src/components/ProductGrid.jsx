import { Icon } from './Icons'

const productMarks = { 'قهوة مختصة':'V', 'قهوة ساخنة':'☕', 'مشروبات باردة':'❄', 'مشروبات 101':'101', 'حلويات':'◒', 'ساندويتشات':'—', 'إضافات/أخرى':'+' }
export default function ProductGrid({ products, category, setCategory, categories, query, setQuery, onSelect }) {
  return <section className="catalog">
    <div className="catalog-heading"><div><h1>نقطة البيع</h1><p>اختر المنتجات لإضافتها إلى الطلب الحالي</p></div><label className="search"><Icon name="search" size={19}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث عن منتج..." /></label></div>
    <nav className="category-tabs" aria-label="الأقسام">{categories.map(cat => <button className={category === cat ? 'selected' : ''} onClick={() => setCategory(cat)} key={cat}>{cat === 'الكل' ? <Icon name="grid" size={18}/> : null}{cat}</button>)}</nav>
    <div className="products-meta"><span>الأكثر استخدامًا</span><span>{products.length} منتج</span></div>
    <div className="product-grid">{products.map(product => <button className={`product-card ${product.unavailable ? 'unavailable' : ''}`} key={product.id} onClick={() => !product.unavailable && onSelect(product)} disabled={product.unavailable}>
      <div className={`product-image shade-${product.id % 5}`}><span>{productMarks[product.category]}</span>{product.favorite && <i className="fav"><Icon name="star" size={14} /></i>}{product.unavailable && <em>غير متوفر</em>}</div>
      <div className="product-info"><b>{product.name}</b><small>{product.english}</small><strong>{product.price ? `${product.price.toLocaleString('ar-IQ')} د.ع` : 'قريبًا'}</strong></div>
    </button>)}</div>
    {!products.length && <div className="empty"><Icon name="search" size={30}/><b>لم يتم العثور على منتج</b><span>جرّب كتابة اسم مختلف</span></div>}
  </section>
}
