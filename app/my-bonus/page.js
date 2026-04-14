'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/utils';

function MyBonusContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;

  const [bonuses, setBonuses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bonuses', { cache: 'no-store' });
        const data = await res.json();
        setBonuses(Array.isArray(data) ? data : []);
      } catch { addToast('خطأ', 'error'); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats — ARC-06: parseFloat on every NUMERIC read so reducers coerce to number.
  const totalAll = bonuses.reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  const unsettled = bonuses.filter((b) => !b.settled).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  const settled = bonuses.filter((b) => b.settled).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  const thisMonth = (() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return bonuses.filter((b) => b.date?.startsWith(ym)).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  })();
  const count = bonuses.length;

  return (
    <AppLayout>
      <div className="page-header">
        <h2>البونص الخاص بي</h2>
        <p>{role === 'driver' ? 'بونص التوصيلات المؤكدة' : 'بونص المبيعات بعد التوصيل'}</p>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards" style={{ marginBottom: '24px' }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>إجمالي البونص</h3>
            <div className="value" style={{ color: '#16a34a' }}>{formatNumber(totalAll)}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#fef3c7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#f59e0b" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>مستحق (لم يُصرف)</h3>
            <div className="value" style={{ color: '#f59e0b' }}>{formatNumber(unsettled)}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>تم صرفه</h3>
            <div className="value" style={{ color: '#1e40af' }}>{formatNumber(settled)}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#e0e7ff' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#4f46e5" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>هذا الشهر</h3>
            <div className="value" style={{ color: '#4f46e5' }}>{formatNumber(thisMonth)}</div>
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          سجل البونص ({count} عملية)
        </h3>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : bonuses.length === 0 ? (
          <div className="empty-state">
            <h3>لا يوجد بونص بعد</h3>
            <p>{role === 'driver' ? 'البونص يُحسب عند تأكيد التوصيل' : 'البونص يُحسب بعد تأكيد توصيل المبيعات'}</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المنتج</th>
                  <th>الكمية</th>
                  {role === 'seller' && <th>السعر الموصى</th>}
                  {role === 'seller' && <th>سعر البيع</th>}
                  <th>ثابت</th>
                  {role === 'seller' && <th>إضافي</th>}
                  <th>المجموع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {bonuses.map((b) => (
                  <tr key={b.id}>
                    <td>{b.date}</td>
                    <td>{b.item}</td>
                    <td className="number-cell">{b.quantity}</td>
                    {role === 'seller' && <td className="number-cell">{formatNumber(b.recommended_price)}</td>}
                    {role === 'seller' && <td className="number-cell">{formatNumber(b.actual_price)}</td>}
                    <td className="number-cell">{formatNumber(b.fixed_bonus)}</td>
                    {role === 'seller' && <td className="number-cell" style={{ color: b.extra_bonus > 0 ? '#1e40af' : '#94a3b8' }}>{formatNumber(b.extra_bonus)}</td>}
                    <td className="number-cell" style={{ fontWeight: 700, color: '#16a34a' }}>{formatNumber(b.total_bonus)}</td>
                    <td>
                      <span className="status-badge" style={{
                        background: b.settled ? '#dcfce7' : '#fef3c7',
                        color: b.settled ? '#16a34a' : '#d97706',
                      }}>
                        {b.settled ? 'تم الصرف' : 'مستحق'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function MyBonusPage() {
  return <ToastProvider><MyBonusContent /></ToastProvider>;
}
