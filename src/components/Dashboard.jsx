import React from 'react'
import { Icon } from './Icons'

export default function Dashboard({ onNavigate, onLogout }) {
  const cards = [
    { id: 'pos', title: 'الكاشير', icon: 'monitor', action: () => onNavigate('pos') },
    { id: 'orders', title: 'الطلبات', icon: 'receipt', action: () => alert('تحت التطوير') },
    { id: 'inventory', title: 'المخزون', icon: 'box', action: () => alert('تحت التطوير') },
    { id: 'reports', title: 'التقارير', icon: 'chart', action: () => onNavigate('reports') },
    { id: 'expenses', title: 'المصاريف', icon: 'wallet', action: () => onNavigate('expenses') },
    { id: 'employees', title: 'الموظفين', icon: 'users', action: () => alert('تحت التطوير') },
    { id: 'settings', title: 'الإعدادات', icon: 'settings', action: () => alert('تحت التطوير') },
    { id: 'captain-sales', title: 'مبيعات الكابتن', icon: 'user', action: () => onNavigate('reports-captain') },
    { id: 'expense-entry', title: 'تسجيل المصروفات', icon: 'plus-circle', action: () => onNavigate('expense-entry') },
    { id: 'purchases', title: 'المشتريات', icon: 'shopping-bag', action: () => alert('تحت التطوير') },
    { id: 'inventory-reconciliation', title: 'التسويات والجرد', icon: 'clipboard', action: () => alert('تحت التطوير') },
    { id: 'logout', title: 'إغلاق النظام', icon: 'logout', action: () => {
      if (window.confirm('هل أنت متأكد من إغلاق النظام؟')) {
        onLogout()
      }
    } },
  ]

  return (
    <div className="dashboard-container" dir="rtl">
      <div className="dashboard-grid">
        {cards.map(card => (
          <button 
            key={card.id} 
            className="dashboard-card" 
            onClick={card.action}
          >
            <div className="card-icon">
              <Icon name={card.icon} size={48} />
            </div>
            <h3>{card.title}</h3>
          </button>
        ))}
      </div>
    </div>
  )
}
