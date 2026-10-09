import React from 'react'
import { Icon } from './Icons'
import OperationalDay from './OperationalDay'

export default function Dashboard({ onNavigate, onLogout, canAccessBackupRecovery = false, operationalDayEnabled = true, operationalDay, operationalDaySummary, settlementPreview, preCloseGuard, pendingTableCount = 0, onPrepareEnd, onPrepareStart, operationalDayLoading, operationalDayError, onStartOperationalDay, onSetOpeningCashBalance, onEndOperationalDay, onReadDiagnostic, canViewDiagnostics = false }) {
  const cards = [
    { id: 'pos', title: 'الكاشير', icon: 'monitor', action: () => onNavigate('pos') },
    { id: 'orders', title: 'الطلبات', icon: 'receipt', action: () => onNavigate('orders') },
    { id: 'pending-tables', title: 'الطاولات المعلقة', icon: 'receipt', action: () => onNavigate('pending-tables') },
    { id: 'inventory', title: 'المخزون', icon: 'box', action: () => alert('تحت التطوير') },
    { id: 'reports', title: 'التقارير', icon: 'chart', action: () => onNavigate('reports') },
    { id: 'expenses', title: 'المصاريف', icon: 'wallet', action: () => onNavigate('expenses') },
    { id: 'cashbox', title: 'الصندوق', icon: 'wallet', action: () => onNavigate('cashbox') },
    { id: 'employees', title: 'الموظفين', icon: 'users', action: () => onNavigate('employees') },
    { id: 'settings', title: 'الإعدادات', icon: 'settings', action: () => onNavigate('settings') },
    { id: 'captain-sales', title: 'مبيعات الكابتن', icon: 'user', action: () => onNavigate('reports-captain') },
    { id: 'purchases', title: 'المشتريات', icon: 'shopping-bag', action: () => onNavigate('purchases') },
    ...(canAccessBackupRecovery ? [{ id: 'backup-recovery', title: 'فحص واسترداد نسخة المبيعات', icon: 'download', action: () => onNavigate('backup-recovery') }] : []),
    { id: 'inventory-reconciliation', title: 'التسويات والجرد', icon: 'clipboard', action: () => alert('تحت التطوير') },
    { id: 'logout', title: 'إغلاق النظام', icon: 'logout', action: () => {
      if (window.confirm('هل أنت متأكد من إغلاق النظام؟')) {
        onLogout()
      }
    } },
  ]

  return (
    <div className="dashboard-container" dir="rtl">
      {operationalDayEnabled && <OperationalDay day={operationalDay} summary={operationalDaySummary} settlementPreview={settlementPreview} preCloseGuard={preCloseGuard} pendingTableCount={pendingTableCount} loading={operationalDayLoading} error={operationalDayError} onPrepareEnd={onPrepareEnd} onPrepareStart={onPrepareStart} onStart={onStartOperationalDay} onSetOpeningCashBalance={onSetOpeningCashBalance} onEnd={onEndOperationalDay} onReadDiagnostic={onReadDiagnostic} canViewDiagnostics={canViewDiagnostics} />}
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
