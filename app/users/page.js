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
  const [toggleTarget, setToggleTarget] = useState(null); // user id to toggle
  const [confirmSettings, setConfirmSettings] = useState(false);

  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'seller' });
  const [settingsForm, setSettingsForm] = useState({ seller_bonus_fixed: '10', seller_bonus_percentage: '50', driver_bonus_fixed: '5' });

  const fetchData = async () => {
    try {
      const [usersRes, settingsRes] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
      ]);
      setUsers(await usersRes.json());
      const s = await settingsRes.json();
      setSettings(s);
      setSettingsForm({ seller_bonus_fixed: s.seller_bonus_fixed || '10', seller_bonus_percentage: s.seller_bonus_percentage || '50', driver_bonus_fixed: s.driver_bonus_fixed || '5' });
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
