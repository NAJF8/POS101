import { useEffect, useState } from 'react'
import { Icon } from './Icons'

// Use the supplied 101 COFFEE HOUSE mark, not the POS promotional artwork.
const logoUrl = `${import.meta.env.BASE_URL}assets/logo.jpg`

function useLiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export default function Header({ onOpenOrders, session, onCashierMenu, onLogout, openOrdersCount = 0 }) {
  const now = useLiveClock()

  const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const getShiftDuration = (openedAt) => {
    const diffMs = Date.now() - openedAt;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours > 0) return `منذ ${hours} ساعات`;
    const minutes = Math.floor(diffMs / (1000 * 60));
    return `منذ ${minutes} دقيقة`;
  }

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand">
          <img src={logoUrl} alt="101 COFFEE HOUSE" />
        </div>
        
        {session && (
          <button className="cashier-btn" onClick={onCashierMenu} title="إعدادات الكاشير">
            <Icon name="user" size={24} />
            <div className="cashier-info">
              <b>{session.cashierNameSnapshot}</b>
              <small>الكاشير</small>
            </div>
          </button>
        )}
      </div>

      <div className="header-right">
        <div className="header-block time-block">
          <Icon name="clock" size={22} />
          <div className="block-info">
            <b>{timeStr}</b>
            <small>{dateStr}</small>
          </div>
        </div>

        {session && (
          <div className="header-block shift-block">
            <i className="status-dot green"></i>
            <div className="block-info">
              <b>الوردية مفتوحة</b>
              <small>{getShiftDuration(session.openedAt)}</small>
            </div>
          </div>
        )}

        <button className="header-btn" onClick={onOpenOrders}>
          <Icon name="receipt" size={20} />
          <span>الطلبات المفتوحة</span>
          {openOrdersCount > 0 && <span className="badge">{openOrdersCount}</span>}
        </button>

        <button className="header-btn">
          <Icon name="settings" size={20} />
          <span>الإعدادات</span>
        </button>

        {session && (
          <button className="header-btn logout-btn" onClick={onLogout}>
            <Icon name="logout" size={20} />
            <span>تسجيل خروج</span>
          </button>
        )}
      </div>
    </header>
  )
}
