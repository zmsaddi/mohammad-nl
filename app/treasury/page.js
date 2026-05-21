'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/utils';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import PageSkeleton from '@/components/PageSkeleton';

const ROLE_LABEL = { admin: 'مدير عام', manager: 'مشرف', driver: 'سائق', seller: 'بائع' };

function TreasuryContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;

  const [boxes, setBoxes] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/treasury/boxes', { cache: 'no-store' });
      const data = await res.json();
      setBoxes(Array.isArray(data?.boxes) ? data.boxes : []);
      setEnabled(data?.enabled !== false);
    } catch { addToast('خطأ في جلب الصناديق', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  const boxName = (b) => b.type === 'main'
    ? 'الصندوق العام (رأس المال)'
    : (b.owner_name || b.owner_username || '—');
  const total = boxes.reduce((s, b) => s + (parseFloat(b.balance) || 0), 0);

  return (
    <AppLayout>
      <div className="page-header">
        <h2>إدارة المال</h2>
        <p>{role === 'admin' ? 'أرصدة كل الصناديق' : role === 'manager' ? 'صندوقك وصناديق السائقين' : 'صندوق عهدتك'}</p>
      </div>

      {!enabled && (
        <div className="card" style={{ marginBottom: 16, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: '0.9rem' }}>
          ⏳ نظام الصناديق قيد التهيئة — الأرصدة ستبدأ بالتحديث عند تفعيله. هذا العرض للاطّلاع فقط حالياً.
        </div>
      )}

      <div className="summary-cards" style={{ marginBottom: 24 }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>{role === 'admin' ? 'إجمالي كاش المشروع' : 'إجمالي المعروض'}</h3>
            <div className="value" style={{ color: '#16a34a' }}>{formatNumber(total)} €</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>عدد الصناديق</h3>
            <div className="value" style={{ color: '#1e40af' }}>{boxes.length}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>الصناديق</h3>
        {loading ? (
          <PageSkeleton rows={4} />
        ) : boxes.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد صناديق</h3>
            <p>شغّل تهيئة النظام (/api/init) لإنشاء الصناديق.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصندوق</th>
                  <th>النوع</th>
                  <th>الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {boxes.map((b) => {
                  const bal = parseFloat(b.balance) || 0;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>
                        {boxName(b)}
                        {b.type !== 'main' && b.owner_role && (
                          <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.8rem' }}> ({ROLE_LABEL[b.owner_role] || b.owner_role})</span>
                        )}
                      </td>
                      <td>{b.type === 'main' ? 'عام' : 'عهدة'}</td>
                      <td className="number-cell" style={{ fontWeight: 700, color: bal < 0 ? '#dc2626' : '#16a34a' }}>
                        {formatNumber(bal)} €
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function TreasuryPage() {
  return <ToastProvider><TreasuryContent /></ToastProvider>;
}
