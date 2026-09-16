import { useMemo, useState } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import OrderPanel from './components/OrderPanel'
import { ProductOptions, OrderType, TableSelection, Payment, Success, OpenOrders, History } from './components/Dialogs'
import { categories, products } from './data/menu'
import { Icon } from './components/Icons'

const blankOrder = index => ({ id:index, name:`طلب ${index}`, items:[], table:null })
const format = value => `${value.toLocaleString('ar-IQ')} د.ع`

export default function App() {
  const [orders, setOrders] = useState([1,2,3,4].map(blankOrder))
  const [active, setActive] = useState(0)
  const [category, setCategory] = useState('الكل')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const activeOrder = orders[active]
  const total = activeOrder.items.reduce((sum,item) => sum + item.price * item.quantity,0)
  const visibleProducts = useMemo(() => products.filter(product => (category === 'الكل' || product.category === category) && `${product.name} ${product.english}`.toLowerCase().includes(query.toLowerCase())), [category, query])
  const amend = callback => setOrders(current => current.map((order,index) => index === active ? callback(order) : order))
  const addProduct = product => { amend(order => ({...order, items:[...order.items, {...product, lineId:`${product.id}-${Date.now()}`}]})); setModal(null) }
  const selectProduct = product => { if(product.configurable) { setSelected(product); setModal('options') } else addProduct({...product, quantity:1}) }
  const updateQuantity = (lineId, delta) => amend(order => ({...order, items: order.items.flatMap(item => item.lineId === lineId ? (item.quantity + delta <= 0 ? [] : [{...item,quantity:item.quantity+delta}]) : [item])}))
  const removeItem = lineId => amend(order => ({...order,items:order.items.filter(item => item.lineId !== lineId)}))
  const chooseType = type => { setModal(null); type === 'داخل الكوفي' ? setModal('tables') : setModal('payment') }
  const chooseTable = table => { amend(order => ({...order,table})); setModal('payment') }
  const complete = () => { setModal('success') }
  const newOrder = () => { amend(order=>({...order,items:[],table:null})); setModal(null) }
  return <main className="app-shell"><Header onOpenOrders={() => setModal('openOrders')} /><div className="quick-orders">{orders.map((order,index) => <button onClick={() => setActive(index)} key={order.id} className={active === index ? 'active' : ''}><span>طلب {order.id}</span>{order.table && <small>طاولة {order.table}</small>}{order.items.length > 0 && <i>{order.items.reduce((sum,item)=>sum+item.quantity,0)}</i>}</button>)}<button className="quick-add" aria-label="فتح مساحة طلب جديدة"><Icon name="plus" size={18}/></button></div><div className="pos-layout"><ProductGrid products={visibleProducts} category={category} setCategory={setCategory} categories={categories} query={query} setQuery={setQuery} onSelect={selectProduct}/><OrderPanel order={activeOrder} updateQuantity={updateQuantity} removeItem={removeItem} onEdit={item => { setSelected(item); setModal('options') }} onContinue={() => setModal('orderType')} onHold={() => setModal('openOrders')}/></div>
    {modal === 'options' && <ProductOptions product={selected} onClose={() => setModal(null)} onAdd={addProduct}/>} {modal === 'orderType' && <OrderType onClose={() => setModal(null)} onChoose={chooseType}/>} {modal === 'tables' && <TableSelection onClose={() => setModal(null)} onChoose={chooseTable}/>} {modal === 'payment' && <Payment total={total} onClose={() => setModal(null)} onSuccess={complete}/>} {modal === 'success' && <Success total={total} onClose={newOrder} onReceipt={() => setModal('history')}/>} {modal === 'openOrders' && <OpenOrders onClose={() => setModal(null)} onHistory={() => setModal('history')}/>} {modal === 'history' && <History onClose={() => setModal(null)}/>}
  </main>
}
