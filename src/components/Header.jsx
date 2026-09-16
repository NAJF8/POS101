import { useEffect, useState } from 'react'
import { Icon } from './Icons'

// Use the supplied transparent 101 COFFEE HOUSE mark in the POS header.
// The available source logo contains baked-in checkerboard pixels. Keep the
// original asset untouched until a verified clean transparent master is supplied.
const logoUrl = `${import.meta.env.BASE_URL}assets/branding/logo.jpg`

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
        
        <div className="header-block time-block">
          <Icon name="clock" size={22} />
          <div className="block-info">
            <b>{timeStr}</b>
            <small>{dateStr}</small>
          </div>
        </div>
      </div>

      <div className="header-right">
        {session && (
          <button className="header-btn logout-btn" onClick={onLogout}>
            <Icon name="logout" size={20} />
            <span>تسجيل خروج</span>
          </button>
        )}

        <button className="header-btn theme-btn">
          <Icon name="sun" size={20} />
        </button>

        <button className="header-btn">
          <Icon name="settings" size={20} />
          <span>الإعدادات</span>
        </button>

        <button className="header-btn outline-btn" onClick={() => window.dispatchEvent(new CustomEvent('open-history'))}>
          <Icon name="receipt" size={20} />
          <span>سجل الطلبات</span>
        </button>

        <button className="header-btn outline-btn" onClick={onOpenOrders}>
          <Icon name="receipt" size={20} />
          <span>الطلبات المفتوحة</span>
          <span className="badge">{openOrdersCount}</span>
        </button>

        <div className="brand-left">
          <img src={logoUrl} alt="101 COFFEE HOUSE" style={{ height: '36px' }} />
          <div style={{ fontSize: '12px', fontWeight: 'bold' }}>كوفي هاوس</div>
        </div>
      </div>
    </header>
  )
}
