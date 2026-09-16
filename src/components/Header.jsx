import { Icon } from './Icons'

const logoUrl = `${import.meta.env.BASE_URL}assets/branding/101-pos-original.png`

export default function Header({ onOpenOrders, session, onCashierMenu }) {
  return <header className="app-header">
    <div className="brand"><img src={logoUrl} alt="101 COFFEE HOUSE — 101 POS" /><span className="brand-divider" /><strong>101 POS</strong></div>
    <div className="header-actions"><button className="open-orders" onClick={onOpenOrders}><Icon name="receipt" size={18} /> الطلبات المفتوحة</button>{session&&<span className="shift-status"><i /> الوردية مفتوحة <small>منذ {new Date(session.openedAt).toLocaleTimeString('ar-IQ',{hour:'2-digit',minute:'2-digit'})}</small></span>}<span className="time">١٠:٣٢ ص</span>{session&&<button className="cashier" onClick={onCashierMenu}><span>{session.cashierNameSnapshot[0]}</span><b>{session.cashierNameSnapshot}</b><Icon name="user" size={17} /></button>}</div>
  </header>
}
