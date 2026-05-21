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
  const username = session?.user?.username;
  const canFund = role === 'admin' || role === 'manager';

  const [boxes, setBoxes] = useState([]);
  const [pending, setPending] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [generalBoxId, setGeneralBoxId] = useState(null);
  const [myBoxId, setMyBoxId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [handAmount, setHandAmount] = useState('');
  const [fundForm, setFundForm] = useState({ toBoxId: '', amount: '' });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/treasury/boxes', { cache: 'no-store' });
      const data = await res.json();
      setBoxes(Array.isArray(data?.boxes) ? data.boxes : []);
      setEnabled(data?.enabled !== false);
      setGeneralBoxId(data?.generalBoxId ?? null);
      setMyBoxId(data?.myBoxId ?? null);
      if (data?.enabled !== false) {
        const hres = await fetch('/api/treasury/handovers', { cache: 'no-store' });
        if (hres.ok) setPending(await hres.json());
      }
    } catch { addToast('خطأ في جلب البيانات', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  const boxName = (b) => b.type === 'main' ? 'الصندوق العام' : (b.owner_name || b.owner_username || '—');
  const total = boxes.reduce((s, b) => s + (parseFloat(b.balance) || 0), 0);
  // Funding recipients the caller may fund: manager → drivers; admin → any custody box.
  const fundTargets = boxes.filter((b) => b.type === 'custody' && (role === 'admin' || b.owner_role === 'driver') && b.owner_username !== username);

  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  };

  const handleHandover = async () => {
    if (!myBoxId || !generalBoxId) { addToast('الصناديق غير مهيّأة', 'error'); return; }
    if (!(parseFloat(handAmount) > 0)) { addToast('أدخل مبلغاً صحيحاً', 'error'); return; }
    const { ok, d } = await post('/api/treasury/handovers', { kind: 'handover', fromBoxId: myBoxId, toBoxId: generalBoxId, amount: handAmount });
    if (ok) { addToast('تم إنشاء طلب تسليم — بانتظار تأكيد الصندوق العام'); setHandAmount(''); fetchData(); }
    else addToast(d.error || 'خطأ', 'error');
  };

  const handleFund = async () => {
    if (!fundForm.toBoxId) { addToast('اختر المستلم', 'error'); return; }
    if (!(parseFloat(fundForm.amount) > 0)) { addToast('أدخل مبلغاً صحيحاً', 'error'); return; }
    const fromBoxId = role === 'admin' ? generalBoxId : myBoxId; // admin funds from treasury, manager from own
    if (!fromBoxId) { addToast('صندوق المصدر غير مهيّأ', 'error'); return; }
    const { ok, d } = await post('/api/treasury/handovers', { kind: 'funding', fromBoxId, toBoxId: Number(fundForm.toBoxId), amount: fundForm.amount });
    if (ok) { addToast('تم إنشاء طلب تمويل — بانتظار تأكيد المستلم'); setFundForm({ toBoxId: '', amount: '' }); fetchData(); }
    else addToast(d.error || 'خطأ', 'error');
  };

  const handleConfirm = async (id) => {
    const { ok, d } = await post(`/api/treasury/handovers/${id}/confirm`);
    if (ok) { addToast('تم تأكيد التحويل ✓'); fetchData(); } else addToast(d.error || 'خطأ', 'error');
  };
  const handleReject = async (id) => {
    const { ok, d } = await post(`/api/treasury/handovers/${id}/reject`);
    if (ok) { addToast('تم رفض الطلب'); fetchData(); } else addToast(d.error || 'خطأ', 'error');
  };

  const partyLabel = (type, name, owner) => type === 'main' ? 'الصندوق العام' : (name || owner || '—');

  return (
    <AppLayout>
      <div className="page-header">
        <h2>إدارة المال</h2>
        <p>{role === 'admin' ? 'أرصدة كل الصناديق والتحويلات' : role === 'manager' ? 'صندوقك وصناديق السائقين' : 'صندوق عهدتك'}</p>
      </div>

      {!enabled && (
        <div className="card" style={{ marginBottom: 16, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: '0.9rem' }}>
          ⏳ نظام الصناديق قيد التهيئة — العرض للاطّلاع فقط، والإجراءات تظهر عند التفعيل.
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
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>طلبات معلّقة</h3>
            <div className="value" style={{ color: '#1e40af' }}>{pending.length}</div>
          </div>
        </div>
      </div>

      {/* Boxes */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>الصناديق</h3>
        {loading ? (
          <PageSkeleton rows={4} />
        ) : boxes.length === 0 ? (
          <div className="empty-state"><h3>لا توجد صناديق</h3><p>شغّل تهيئة النظام (/api/init) لإنشاء الصناديق.</p></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>الصندوق</th><th>النوع</th><th>الرصيد</th></tr></thead>
              <tbody>
                {boxes.map((b) => {
                  const bal = parseFloat(b.balance) || 0;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>
                        {boxName(b)}
                        {b.type !== 'main' && b.owner_role && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.8rem' }}> ({ROLE_LABEL[b.owner_role] || b.owner_role})</span>}
                      </td>
                      <td>{b.type === 'main' ? 'عام' : 'عهدة'}</td>
                      <td className="number-cell" style={{ fontWeight: 700, color: bal < 0 ? '#dc2626' : '#16a34a' }}>{formatNumber(bal)} €</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Actions — only when the treasury is live */}
      {enabled && (
        <>
          {/* Pending requests */}
          <div className="card" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>طلبات بانتظار التأكيد ({pending.length})</h3>
            {pending.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>لا توجد طلبات معلّقة.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>المبلغ</th><th>المُبادِر</th><th>إجراء</th></tr></thead>
                  <tbody>
                    {pending.map((h) => {
                      const mine = h.initiated_by === username;
                      return (
                        <tr key={h.id}>
                          <td>{h.kind === 'funding' ? 'تمويل' : 'تسليم'}</td>
                          <td>{partyLabel(h.from_type, h.from_name, h.from_owner)}</td>
                          <td>{partyLabel(h.to_type, h.to_name, h.to_owner)}</td>
                          <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(h.amount)} €</td>
                          <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{h.initiated_by}{mine ? ' (أنت)' : ''}</td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {!mine && (
                              <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => handleConfirm(h.id)}>✓ تأكيد</button>
                            )}
                            <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => handleReject(h.id)}>{mine ? 'إلغاء الطلب' : 'رفض'}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Hand over to the general box */}
          {myBoxId && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>تسليم عهدة إلى الصندوق العام</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>سلّم مبلغاً من صندوقك إلى الصندوق العام — يتحرّك المال بعد تأكيد مدير عام.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ maxWidth: 180, margin: 0 }}>
                  <label>المبلغ (€)</label>
                  <input type="number" min="0" step="any" value={handAmount} onChange={(e) => setHandAmount(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={handleHandover}>إنشاء طلب تسليم</button>
              </div>
            </div>
          )}

          {/* Funding (admin/manager) */}
          {canFund && fundTargets.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>تمويل صندوق</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
                {role === 'admin' ? 'تمويل من الصندوق العام إلى صندوق شخص.' : 'تمويل سائق من صندوقك.'} يتحرّك المال بعد تأكيد المستلم.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ maxWidth: 240, margin: 0 }}>
                  <label>المستلم</label>
                  <select value={fundForm.toBoxId} onChange={(e) => setFundForm({ ...fundForm, toBoxId: e.target.value })}>
                    <option value="">-- اختر --</option>
                    {fundTargets.map((b) => (
                      <option key={b.id} value={b.id}>{boxName(b)} ({ROLE_LABEL[b.owner_role] || b.owner_role})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ maxWidth: 180, margin: 0 }}>
                  <label>المبلغ (€)</label>
                  <input type="number" min="0" step="any" value={fundForm.amount} onChange={(e) => setFundForm({ ...fundForm, amount: e.target.value })} />
                </div>
                <button className="btn btn-primary" onClick={handleFund}>إنشاء طلب تمويل</button>
              </div>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}

export default function TreasuryPage() {
  return <ToastProvider><TreasuryContent /></ToastProvider>;
}
