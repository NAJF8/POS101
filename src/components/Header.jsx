import { Icon } from './Icons'

const logoUrl = `${import.meta.env.BASE_URL}assets/branding/101-pos-original.png`

export default function Header({ onOpenOrders }) {
  return <header className="app-header">
    <div className="brand"><img src={logoUrl} alt="101 COFFEE HOUSE — 101 POS" /><span className="brand-divider" /><strong>101 POS</strong></div>
    <div className="header-actions"><button className="open-orders" onClick={onOpenOrders}><Icon name="receipt" size={18} /> الطلبات المفتوحة</button><span className="shift-status"><i /> الوردية مفتوحة <small>منذ 08:00 ص</small></span><span className="time">١٠:٣٢ ص</span><button className="cashier"><span>أ</span><b>أحمد</b><Icon name="user" size={17} /></button></div>
  </header>
}
