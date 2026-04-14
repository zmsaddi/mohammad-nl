'use client';

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber, getTodayDate } from '@/lib/utils';

const TYPES = {
  seller_payout: { label: 'دفع بونص بائع', color: '#16a34a', bg: '#dcfce7' },
  driver_payout: { label: 'دفع بونص سائق', color: '#7c3aed', bg: '#ede9fe' },
  profit_distribution: { label: 'توزيع أرباح', color: '#1e40af', bg: '#dbeafe' },
};

function SettlementsContent() {
  const addToast = useToast();
  const [settlements, setSettlements] = useState([]);
  const [bonuses, setBonuses] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({ date: getTodayDate(), type: 'seller_payout', username: '', description: '', amount: '', notes: '' });

  const fetchData = async () => {
    try {
      const [sRes, bRes, uRes] = await Promise.all([
        fetch('/api/settlements', { cache: 'no-store' }),
        fetch('/api/bonuses', { cache: 'no-store' }),
        fetch('/api/users', { cache: 'no-store' }),
      ]);
      setSettlements(await sRes.json());
      setBonuses(await bRes.json());
      setUsers(await uRes.json());
    } catch { addToast('خطأ', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  // Calculate unsettled bonuses per user — ARC-06: parseFloat for NUMERIC.
  const unsettledByUser = {};
  (Array.isArray(bonuses) ? bonuses : []).filter((b) => !b.settled).forEach((b) => {
    if (!unsettledByUser[b.username]) unsettledByUser[b.username] = { total: 0, count: 0, role: b.role };
    unsettledByUser[b.username].total += parseFloat(b.total_bonus) || 0;
    unsettledByUser[b.username].count += 1;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.description || !form.amount) { addToast('الوصف والمبلغ مطلوبين', 'error'); return; }
    try {
      const res = await fetch('/api/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), cache: 'no-store' });
      if (res.ok) {
        addToast('تم تسجيل التسوية');
        setForm({ date: getTodayDate(), type: 'seller_payout', username: '', description: '', amount: '', notes: '' });
        setShowForm(false); fetchData();
      } else { const d = await res.json(); addToast(d.error, 'error'); }
    } catch { addToast('خطأ', 'error'); }
  };

  const handleQuickSettle = (username, total) => {
    const user = (Array.isArray(users) ? users : []).find((u) => u.username === username);
    const role = unsettledByUser[username]?.role;
    setForm({
      date: getTodayDate(),
      type: role === 'driver' ? 'driver_payout' : 'seller_payout',
      username,
      description: `تسوية بونص ${user?.name || username} - ${unsettledByUser[username]?.count || 0} عمليات`,
      amount: String(Math.round(total * 100) / 100),
      notes: '',
    });
    setShowForm(true);
  };

  return (
    <AppLayout>
      <div className="page-header">
        <h2>التسويات</h2>
        <p>تسوية حسابات البائعين والسائقين</p>
      </div>

      {/* Unsettled Bonuses */}
      {Object.keys(unsettledByUser).length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#dc2626' }}>بونص مستحق (غير مسوّى)</h3>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>المستخدم</th><th>الدور</th><th>عدد العمليات</th><th>المبلغ المستحق</th><th>إجراء</th></tr></thead>
              <tbody>
                {Object.entries(unsettledByUser).map(([username, data]) => {
                  const user = (Array.isArray(users) ? users : []).find((u) => u.username === username);
                  const r = TYPES[data.role === 'driver' ? 'driver_payout' : 'seller_payout'];
                  return (
                    <tr key={username}>
                      <td style={{ fontWeight: 600 }}>{user?.name || username}</td>
                      <td><span className="status-badge" style={{ background: r.bg, color: r.color }}>{data.role === 'driver' ? 'سائق' : 'بائع'}</span></td>
                      <td className="number-cell">{data.count}</td>
                      <td className="number-cell" style={{ fontWeight: 700, color: '#dc2626' }}>{formatNumber(data.total)}</td>
                      <td><button className="btn btn-primary btn-sm" onClick={() => handleQuickSettle(username, data.total)}>تسوية</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settlement Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>تسجيل تسوية</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>التاريخ *</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>النوع *</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>المستخدم</label>
                <select value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}>
                  <option value="">-- اختر --</option>
                  {(Array.isArray(users) ? users : []).map((u) => <option key={u.id} value={u.username}>{u.name} ({u.role})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>المبلغ *</label>
                <input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>الوصف *</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف التسوية" required />
              </div>
              <div className="form-group">
                <label>ملاحظات</label>
                <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary">تسجيل التسوية</button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {/* History */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>سجل التسويات (لا يُحذف)</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!showForm && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ تسوية جديدة</button>}
          </div>
        </div>
        {loading ? <div className="loading-overlay"><div className="spinner"></div></div> : (
          !Array.isArray(settlements) || settlements.length === 0 ? (
            <div className="empty-state"><h3>لا توجد تسويات</h3></div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>المستخدم</th><th>الوصف</th><th>المبلغ</th><th>بواسطة</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  {settlements.map((s) => {
                    const t = TYPES[s.type];
                    return (
                      <tr key={s.id}>
                        <td>{s.id}</td>
                        <td>{s.date}</td>
                        <td><span className="status-badge" style={{ background: t?.bg, color: t?.color }}>{t?.label || s.type}</span></td>
                        <td style={{ fontWeight: 600 }}>{s.username || '-'}</td>
                        <td>{s.description}</td>
                        <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(s.amount)}</td>
                        <td>{s.settled_by}</td>
                        <td>{s.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </AppLayout>
  );
}

export default function SettlementsPage() {
  return <ToastProvider><SettlementsContent /></ToastProvider>;
}
