import { useEffect, useState } from 'react'
import { Icon } from './Icons'

const logoUrl = `${import.meta.env.BASE_URL}assets/branding/101-pos-original.png`

function useLiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export default function Header({ onOpenOrders, session, onCashierMenu }) {
  const now = useLiveClock()

  const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('ar-IQ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <header className="app-header">
      {/* Brand */}
      <div className="brand">
        <img src={logoUrl} alt="101 COFFEE HOUSE" />
        <span className="brand-divider" />
        <div>
          <strong>101 COFFEE HOUSE</strong>
          <span className="brand-sub">نظام نقاط البيع</span>
        </div>
      </div>

      {/* Center — status chips */}
      <div className="header-center">
        {session && (
          <div className="shift-status">
            <i />
            <span>الوردية مفتوحة</span>
            <small>منذ {new Date(session.openedAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
        )}
        <button className="open-orders-btn" onClick={onOpenOrders}>
          <Icon name="receipt" size={16} />
          <span>الطلبات المفتوحة</span>
        </button>
      </div>

      {/* Right — time + cashier + actions */}
      <div className="header-actions">
        <div className="header-time">
          <span className="time-val">{timeStr}</span>
          <span className="time-date">{dateStr}</span>
        </div>

        {session && (
          <button className="cashier-btn" onClick={onCashierMenu} title="إعدادات الكاشير">
            <div className="cashier-avatar">{session.cashierNameSnapshot[0]}</div>
            <div className="cashier-info">
              <b>{session.cashierNameSnapshot}</b>
              <small>الكاشير</small>
            </div>
            <Icon name="user" size={15} />
          </button>
        )}

        {!session && (
          <button className="header-icon-btn" title="إعدادات">
            <Icon name="grid" size={17} />
          </button>
        )}
      </div>
    </header>
  )
}
