'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';

const ROLES = [
  { value: 'admin', label: 'مدير عام', color: '#dc2626', bg: '#fee2e2' },
  { value: 'manager', label: 'مشرف', color: '#1e40af', bg: '#dbeafe' },
  { value: 'seller', label: 'بائع', color: '#16a34a', bg: '#dcfce7' },
  { value: 'driver', label: 'سائق', color: '#7c3aed', bg: '#ede9fe' },
];

function UsersContent() {
  const { data: session } = useSession();
  const addToast = useToast();

  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  // v1.1 F-017 — confirmation gates for destructive one-click actions
  const [toggleTarget, setToggleTarget] = useState(null);
  const [confirmSettings, setConfirmSettings] = useState(false);
  // v1.1 F-007 — per-user bonus rate overrides
  const [bonusRates, setBonusRates] = useState([]);
  const [rateForm, setRateForm] = useState({ username: '', seller_fixed: '', seller_percentage: '', driver_fixed: '' });
  const [editingRate, setEditingRate] = useState(null);

  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'seller' });
  const [settingsForm, setSettingsForm] = useState({ seller_bonus_fixed: '10', seller_bonus_percentage: '50', driver_bonus_fixed: '5' });

  const fetchData = async () => {
    try {
      const [usersRes, settingsRes, ratesRes] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
        fetch('/api/users/bonus-rates', { cache: 'no-store' }),
      ]);
      setUsers(await usersRes.json());
      const s = await settingsRes.json();
      setSettings(s);
      setSettingsForm({ seller_bonus_fixed: s.seller_bonus_fixed || '10', seller_bonus_percentage: s.seller_bonus_percentage || '50', driver_bonus_fixed: s.driver_bonus_fixed || '5' });
      if (ratesRes.ok) setBonusRates(await ratesRes.json());
    } catch { addToast('خطأ في جلب البيانات', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editUser) {
        await fetch('/api/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editUser.id, name: form.name, role: form.role, password: form.password || undefined }), cache: 'no-store' });
        addToast('تم تحديث المستخدم');
      } else {
        if (!form.username || !form.password || !form.name) { addToast('جميع الحقول مطلوبة', 'error'); return; }
        const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) { addToast(data.error, 'error'); return; }
        addToast('تم إضافة المستخدم');
      }
      setForm({ username: '', password: '', name: '', role: 'seller' });
      setShowForm(false); setEditUser(null); fetchData();
    } catch { addToast('خطأ', 'error'); }
  };

  // v1.1 F-017 — gated through ConfirmModal (pre-v1.1 this fired on one click)
  const handleToggle = async (id) => {
    await fetch('/api/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, toggleActive: true }), cache: 'no-store' });
    addToast('تم تحديث الحالة'); setToggleTarget(null); fetchData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/users?id=${deleteId}`, { method: 'DELETE', cache: 'no-store' });
    addToast('تم حذف المستخدم'); setDeleteId(null); fetchData();
  };

  // v1.1 F-017 — gated through ConfirmModal
  const handleSaveSettings = async () => {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsForm), cache: 'no-store' });
    addToast('تم حفظ الإعدادات'); setConfirmSettings(false); fetchData();
  };

  // v1.1 F-007 — per-user bonus rate override handlers
  const handleSaveRate = async () => {
    if (!rateForm.username) { addToast('اختر مستخدم', 'error'); return; }
    try {
      const res = await fetch('/api/users/bonus-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rateForm),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم حفظ معدلات البونص المخصصة');
        setRateForm({ username: '', seller_fixed: '', seller_percentage: '', driver_fixed: '' });
        setEditingRate(null);
        fetchData();
      } else {
        const d = await res.json();
        addToast(d.error || 'خطأ', 'error');
      }
    } catch { addToast('خطأ في الاتصال', 'error'); }
  };
  const handleDeleteRate = async (username) => {
    try {
      const res = await fetch(`/api/users/bonus-rates?username=${encodeURIComponent(username)}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) { addToast('تم حذف المعدل المخصص — يستخدم الإعدادات العامة الآن'); fetchData(); }
      else { const d = await res.json(); addToast(d.error || 'خطأ', 'error'); }
    } catch { addToast('خطأ', 'error'); }
  };
  const startEditRate = (r) => {
    setEditingRate(r.username);
    setRateForm({
      username: r.username,
      seller_fixed: r.seller_fixed != null ? String(parseFloat(r.seller_fixed)) : '',
      seller_percentage: r.seller_percentage != null ? String(parseFloat(r.seller_percentage)) : '',
      driver_fixed: r.driver_fixed != null ? String(parseFloat(r.driver_fixed)) : '',
    });
  };

  // Users eligible for per-user overrides: sellers + drivers (admin/manager
  // don't earn bonuses per the locked business rule)
  const overridableUsers = (Array.isArray(users) ? users : []).filter(
    (u) => (u.role === 'seller' || u.role === 'driver') && u.active
  );
  // Users that DON'T have an override yet — available for the "add" dropdown
  const rateUsernames = new Set((bonusRates || []).map((r) => r.username));
  const usersWithoutRate = overridableUsers.filter((u) => !rateUsernames.has(u.username));

  const startEdit = (u) => { setEditUser(u); setForm({ username: u.username, password: '', name: u.name, role: u.role }); setShowForm(true); };

  return (
    <AppLayout>
      <div className="page-header">
        <h2>إدارة المستخدمين</h2>
        <p>إضافة وإدارة حسابات المستخدمين والصلاحيات</p>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>{editUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="user-username">اسم المستخدم (للدخول) *</label>
                <input id="user-username" type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="username" disabled={!!editUser} required={!editUser} style={{ direction: 'ltr', textAlign: 'right' }} />
              </div>
              <div className="form-group">
                <label htmlFor="user-password">{editUser ? 'كلمة مرور جديدة (اتركه فارغ لعدم التغيير)' : 'كلمة المرور *'}</label>
                <input id="user-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••" required={!editUser} />
              </div>
              <div className="form-group">
                <label htmlFor="user-name">الاسم الكامل *</label>
                <input id="user-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="الاسم" required />
              </div>
              <div className="form-group">
                <label htmlFor="user-role">الدور *</label>
                <select id="user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary">{editUser ? 'حفظ التعديلات' : 'إضافة مستخدم'}</button>
              <button type="button" className="btn btn-outline" onClick={() => { setShowForm(false); setEditUser(null); setForm({ username: '', password: '', name: '', role: 'seller' }); }}>إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>المستخدمين ({users.length || 0})</h3>
          {!showForm && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ إضافة مستخدم</button>}
        </div>
        {loading ? <div className="loading-overlay"><div className="spinner"></div></div> : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>اسم المستخدم</th><th>الاسم</th><th>الدور</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {(Array.isArray(users) ? users : []).map((u) => {
                  const r = ROLES.find((rl) => rl.value === u.role);
                  return (
                    <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                      <td>{u.id}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right', fontWeight: 600 }}>{u.username}</td>
                      <td>{u.name}</td>
                      <td><span className="status-badge" style={{ background: r?.bg, color: r?.color }}>{r?.label || u.role}</span></td>
                      <td>
                        <button className="btn btn-sm" onClick={() => setToggleTarget(u.id)} style={{ background: u.active ? '#dcfce7' : '#fee2e2', color: u.active ? '#16a34a' : '#dc2626', border: 'none', cursor: 'pointer' }}>
                          {u.active ? 'مفعّل' : 'معطّل'}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => startEdit(u)}>تعديل</button>
                          {u.username !== 'admin' && <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(u.id)}>حذف</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bonus Settings */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>إعدادات البونص</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>بونص ثابت للبائع (لكل توصيلة مؤكدة)</label>
            <input type="number" min="0" step="any" value={settingsForm.seller_bonus_fixed} onChange={(e) => setSettingsForm({ ...settingsForm, seller_bonus_fixed: e.target.value })} />
          </div>
          <div className="form-group">
            <label>نسبة البائع من فرق السعر (%)</label>
            <input type="number" min="0" max="100" value={settingsForm.seller_bonus_percentage} onChange={(e) => setSettingsForm({ ...settingsForm, seller_bonus_percentage: e.target.value })} />
          </div>
          <div className="form-group">
            <label>بونص ثابت للسائق (لكل توصيلة مؤكدة)</label>
            <input type="number" min="0" step="any" value={settingsForm.driver_bonus_fixed} onChange={(e) => setSettingsForm({ ...settingsForm, driver_bonus_fixed: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setConfirmSettings(true)} style={{ marginTop: '12px' }}>حفظ الإعدادات</button>
      </div>

      {/* v1.1 F-007 — per-user bonus rate overrides. Shows existing
          overrides in a table, with an "add override" form below. Users
          without an override use the global settings above. */}
      <div className="card" style={{ marginTop: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>
          معدلات بونص مخصصة لكل مستخدم
        </h3>
        <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '12px' }}>
          المستخدمون بدون معدل مخصص يستخدمون الإعدادات العامة أعلاه.
          أضف معدل مخصص لتجاوز القيم العامة لبائع أو سائق محدد.
        </p>

        {/* Existing overrides table */}
        {Array.isArray(bonusRates) && bonusRates.length > 0 && (
          <div className="table-container" style={{ marginBottom: '16px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>بونص البائع الثابت</th>
                  <th>نسبة البائع %</th>
                  <th>بونص السائق الثابت</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {bonusRates.map((r) => {
                  const user = (Array.isArray(users) ? users : []).find((u) => u.username === r.username);
                  return (
                    <tr key={r.username}>
                      <td style={{ fontWeight: 600 }}>{user?.name || r.username}</td>
                      <td className="number-cell">{r.seller_fixed != null ? parseFloat(r.seller_fixed) : '—'}</td>
                      <td className="number-cell">{r.seller_percentage != null ? `${parseFloat(r.seller_percentage)}%` : '—'}</td>
                      <td className="number-cell">{r.driver_fixed != null ? parseFloat(r.driver_fixed) : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => startEditRate(r)}>تعديل</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeleteRate(r.username)}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/edit override form */}
        <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '10px' }}>
            {editingRate ? `تعديل معدل: ${editingRate}` : 'إضافة معدل مخصص جديد'}
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>المستخدم</label>
              {editingRate ? (
                <input type="text" value={editingRate} disabled style={{ background: '#e2e8f0' }} />
              ) : (
                <select value={rateForm.username} onChange={(e) => setRateForm({ ...rateForm, username: e.target.value })}>
                  <option value="">-- اختر --</option>
                  {usersWithoutRate.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.name || u.username} ({u.role === 'seller' ? 'بائع' : 'سائق'})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-group">
              <label>بونص البائع الثابت (€)</label>
              <input type="number" min="0" step="any" placeholder={settingsForm.seller_bonus_fixed}
                value={rateForm.seller_fixed} onChange={(e) => setRateForm({ ...rateForm, seller_fixed: e.target.value })} />
            </div>
            <div className="form-group">
              <label>نسبة البائع من فرق السعر (%)</label>
              <input type="number" min="0" max="100" placeholder={settingsForm.seller_bonus_percentage}
                value={rateForm.seller_percentage} onChange={(e) => setRateForm({ ...rateForm, seller_percentage: e.target.value })} />
            </div>
            <div className="form-group">
              <label>بونص السائق الثابت (€)</label>
              <input type="number" min="0" step="any" placeholder={settingsForm.driver_bonus_fixed}
                value={rateForm.driver_fixed} onChange={(e) => setRateForm({ ...rateForm, driver_fixed: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveRate}>
              {editingRate ? 'تحديث' : 'إضافة'}
            </button>
            {editingRate && (
              <button className="btn btn-outline btn-sm" onClick={() => {
                setEditingRate(null);
                setRateForm({ username: '', seller_fixed: '', seller_percentage: '', driver_fixed: '' });
              }}>إلغاء</button>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal isOpen={!!deleteId} title="حذف مستخدم" message="هل أنت متأكد؟ لا يمكن التراجع." onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
      {/* v1.1 F-017 — confirmation gates for previously one-click destructive actions */}
      <ConfirmModal
        isOpen={!!toggleTarget}
        title="تغيير حالة المستخدم"
        message="هل أنت متأكد من تغيير حالة هذا المستخدم (تفعيل / تعطيل)؟"
        onConfirm={() => handleToggle(toggleTarget)}
        onCancel={() => setToggleTarget(null)}
      />
      <ConfirmModal
        isOpen={confirmSettings}
        title="حفظ إعدادات البونص"
        message="سيتم تحديث إعدادات البونص لجميع المبيعات المستقبلية. هل أنت متأكد؟"
        onConfirm={handleSaveSettings}
        onCancel={() => setConfirmSettings(false)}
      />
    </AppLayout>
  );
}

export default function UsersPage() {
  return <ToastProvider><UsersContent /></ToastProvider>;
}
