import { useEffect, useState } from 'react'
import { Icon } from './Icons'
import { formatTime, formatDate, toArabic } from '../utils.js'

const logoUrl = `${import.meta.env.BASE_URL}assets/branding/101-logo-transparent.png`

function useLiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export default function Header({ onOpenOrders, session, onLogout, openOrdersCount = 0, currentView, onNavigate }) {
  const now = useLiveClock()

  const timeStr = formatTime(now, { hour: '2-digit', minute: '2-digit' })
  const dateStr = formatDate(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand">
          <img src={logoUrl} alt="101 COFFEE HOUSE" />
        </div>
        
        {session && (
          <div className="header-block time-block">
            <Icon name="user" size={22} />
            <div className="block-info">
              <b>{session.shiftName}</b>
              <small>الوردية الحالية</small>
            </div>
          </div>
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
        {session && currentView !== 'dashboard' && (
          <button className="header-btn" onClick={() => onNavigate('dashboard')}>
            <Icon name="home" size={20} />
            <span>الرئيسية</span>
          </button>
        )}

        {session && currentView === 'pos' && (
          <>
            <button className="header-btn outline-btn" onClick={() => window.dispatchEvent(new CustomEvent('open-history'))}>
              <Icon name="receipt" size={20} />
              <span>سجل الطلبات</span>
            </button>
            <button className="header-btn outline-btn" onClick={onOpenOrders}>
              <Icon name="receipt" size={20} />
              <span>الطلبات المفتوحة</span>
              <span className="badge">{toArabic(openOrdersCount)}</span>
            </button>
          </>
        )}

        <div className="brand-left">
          <img src={logoUrl} alt="101 COFFEE HOUSE" style={{ height: '36px' }} />
          <div style={{ fontSize: '12px', fontWeight: 'bold' }}>كوفي هاوس</div>
        </div>
      </div>
    </header>
  )
}
