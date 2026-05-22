'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import Pagination, { usePagination } from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { PRODUCT_CATEGORIES, numberInputProps } from '@/lib/utils';

const ROLES = [
  { value: 'admin', label: 'مدير عام', color: '#dc2626', bg: '#fee2e2' },
  { value: 'manager', label: 'مشرف', color: '#1e40af', bg: '#dbeafe' },
  { value: 'seller', label: 'بائع', color: '#16a34a', bg: '#dcfce7' },
  { value: 'driver', label: 'سائق', color: '#7c3aed', bg: '#ede9fe' },
];

function UsersContent() {
  const { data: session } = useSession();
  const addToast = useToast();

  const [activeTab, setActiveTab] = useState('users');
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
  // Per-category bonus rates — categoryForm is keyed by category name.
  const [categoryRates, setCategoryRates] = useState([]);
  const [categoryForm, setCategoryForm] = useState({});
  // Per-user × per-category overrides (most specific layer).
  const [ucSelectedUser, setUcSelectedUser] = useState('');
  const [ucForm, setUcForm] = useState({});
  const [ucRows, setUcRows] = useState([]);

  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'seller' });
  const [settingsForm, setSettingsForm] = useState({ seller_bonus_fixed: '10', seller_bonus_percentage: '50', driver_bonus_fixed: '5' });

  const safeUsers = Array.isArray(users) ? users : [];
  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows } = usePagination(safeUsers, 25);

  const fetchData = async () => {
    try {
      const [usersRes, settingsRes, ratesRes, catRatesRes] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
        fetch('/api/users/bonus-rates', { cache: 'no-store' }),
        fetch('/api/category-bonus-rates', { cache: 'no-store' }),
      ]);
      setUsers(await usersRes.json());
      const s = await settingsRes.json();
      setSettings(s);
      setSettingsForm({ seller_bonus_fixed: s.seller_bonus_fixed || '10', seller_bonus_percentage: s.seller_bonus_percentage || '50', driver_bonus_fixed: s.driver_bonus_fixed || '5' });
      if (ratesRes.ok) setBonusRates(await ratesRes.json());
      if (catRatesRes.ok) {
        const catRows = await catRatesRes.json();
        setCategoryRates(Array.isArray(catRows) ? catRows : []);
        const cf = {};
        (Array.isArray(catRows) ? catRows : []).forEach((r) => {
          cf[r.category] = {
            seller_fixed: r.seller_fixed ?? '',
            seller_percentage: r.seller_percentage ?? '',
            driver_fixed: r.driver_fixed ?? '',
          };
        });
        setCategoryForm(cf);
      }
    } catch { addToast('خطأ في جلب البيانات', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

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

  // Shared guard so a bonus-rate save can't be double-submitted; disables the
  // save buttons while a PUT is in flight.
  const [savingRates, setSavingRates] = useState(false);

  // v1.1 F-007 — per-user bonus rate override handlers
  const handleSaveRate = async () => {
    if (!rateForm.username) { addToast('اختر مستخدم', 'error'); return; }
    if (savingRates) return;
    setSavingRates(true);
    try {
      const res = await fetch('/api/users/bonus-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rateForm),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم حفظ معدلات العمولة المخصصة');
        setRateForm({ username: '', seller_fixed: '', seller_percentage: '', driver_fixed: '' });
        setEditingRate(null);
        fetchData();
      } else {
        const d = await res.json();
        addToast(d.error || 'خطأ', 'error');
      }
    } catch { addToast('خطأ في الاتصال', 'error'); }
    finally { setSavingRates(false); }
  };
  const handleDeleteRate = async (username) => {
    try {
      const res = await fetch(`/api/users/bonus-rates?username=${encodeURIComponent(username)}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) { addToast('تم حذف المعدل المخصص — يستخدم الإعدادات العامة الآن'); fetchData(); }
      else { const d = await res.json(); addToast(d.error || 'خطأ', 'error'); }
    } catch { addToast('خطأ', 'error'); }
  };

  // Per-category bonus rate handlers
  const setCatField = (category, field, value) =>
    setCategoryForm((prev) => ({ ...prev, [category]: { ...(prev[category] || {}), [field]: value } }));
  const handleSaveCategoryRate = async (category) => {
    const v = categoryForm[category] || {};
    if (savingRates) return;
    setSavingRates(true);
    try {
      const res = await fetch('/api/category-bonus-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, ...v }),
        cache: 'no-store',
      });
      if (res.ok) { addToast(`تم حفظ عمولة فئة: ${category}`); fetchData(); }
      else { const d = await res.json(); addToast(d.error || 'خطأ', 'error'); }
    } catch { addToast('خطأ في الاتصال', 'error'); }
    finally { setSavingRates(false); }
  };
  const handleResetCategoryRate = async (category) => {
    try {
      const res = await fetch(`/api/category-bonus-rates?category=${encodeURIComponent(category)}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) { addToast('تمت إعادة الفئة للإعدادات العامة'); fetchData(); }
      else { const d = await res.json(); addToast(d.error || 'خطأ', 'error'); }
    } catch { addToast('خطأ', 'error'); }
  };

  // Per-user × per-category override handlers
  const loadUserCatRates = async (username) => {
    setUcSelectedUser(username);
    setUcForm({});
    setUcRows([]);
    if (!username) return;
    try {
      const res = await fetch(`/api/users/category-bonus-rates?username=${encodeURIComponent(username)}`, { cache: 'no-store' });
      if (res.ok) {
        const rows = await res.json();
        const arr = Array.isArray(rows) ? rows : [];
        setUcRows(arr);
        const f = {};
        arr.forEach((r) => {
          f[r.category] = {
            seller_fixed: r.seller_fixed ?? '',
            seller_percentage: r.seller_percentage ?? '',
            driver_fixed: r.driver_fixed ?? '',
          };
        });
        setUcForm(f);
      }
    } catch { addToast('خطأ في جلب البيانات', 'error'); }
  };
  const setUcField = (category, field, value) =>
    setUcForm((prev) => ({ ...prev, [category]: { ...(prev[category] || {}), [field]: value } }));
  const handleSaveUserCatRate = async (category) => {
    if (!ucSelectedUser) { addToast('اختر مستخدماً أولاً', 'error'); return; }
    const v = ucForm[category] || {};
    if (savingRates) return;
    setSavingRates(true);
    try {
      const res = await fetch('/api/users/category-bonus-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ucSelectedUser, category, ...v }),
        cache: 'no-store',
      });
      if (res.ok) { addToast(`تم الحفظ: ${category}`); loadUserCatRates(ucSelectedUser); }
      else { const d = await res.json(); addToast(d.error || 'خطأ', 'error'); }
    } catch { addToast('خطأ في الاتصال', 'error'); }
    finally { setSavingRates(false); }
  };
  const handleResetUserCatRate = async (category) => {
    try {
      const res = await fetch(`/api/users/category-bonus-rates?username=${encodeURIComponent(ucSelectedUser)}&category=${encodeURIComponent(category)}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) { addToast('تمت الإزالة'); loadUserCatRates(ucSelectedUser); }
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
  const overridableUsers = safeUsers.filter(
    (u) => (u.role === 'seller' || u.role === 'driver') && u.active
  );
  // Users that DON'T have an override yet — available for the "add" dropdown
  const rateUsernames = new Set((bonusRates || []).map((r) => r.username));
  const usersWithoutRate = overridableUsers.filter((u) => !rateUsernames.has(u.username));

  const startEdit = (u) => { setEditUser(u); setForm({ username: u.username, password: '', name: u.name, role: u.role }); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const getRoleLabel = (role) => {
    const r = ROLES.find((rl) => rl.value === role);
    return r?.label || role;
  };

  // --- Render ---

  if (loading) {
    return (
      <AppLayout>
        <div className="page-header">
          <h2>إدارة المستخدمين</h2>
          <p>إضافة وإدارة حسابات المستخدمين والصلاحيات</p>
        </div>
        <PageSkeleton rows={6} showStats={false} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h2>إدارة المستخدمين</h2>
        <p>إضافة وإدارة حسابات المستخدمين والصلاحيات</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          المستخدمين
        </button>
        <button className={`tab ${activeTab === 'bonus' ? 'active' : ''}`} onClick={() => setActiveTab('bonus')}>
          إعدادات العمولة
        </button>
      </div>

      {/* ===================== Tab 1: Users ===================== */}
      {activeTab === 'users' && (
        <>
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
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>المستخدمين ({safeUsers.length || 0})</h3>
              {!showForm && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ إضافة مستخدم</button>}
            </div>

            {/* Desktop table (hidden on mobile — the card list below takes over) */}
            <div className="table-container has-card-fallback">
              <table className="data-table">
                <thead>
                  <tr><th>#</th><th>اسم المستخدم</th><th>الاسم</th><th>الدور</th><th>الحالة</th><th>إجراءات</th></tr>
                </thead>
                <tbody>
                  {paginatedRows.map((u) => (
                    <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                      <td>{u.id}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right', fontWeight: 600 }}>{u.username}</td>
                      <td>{u.name}</td>
                      <td><StatusBadge status={getRoleLabel(u.role)} /></td>
                      <td>
                        <button className="btn btn-sm" onClick={() => setToggleTarget(u.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                          <StatusBadge status={u.active ? 'مفعّل' : 'معطّل'} bg={u.active ? '#dcfce7' : '#fee2e2'} color={u.active ? '#16a34a' : '#dc2626'} />
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => startEdit(u)}>تعديل</button>
                          {u.username !== 'admin' && <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(u.id)}>حذف</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card fallback */}
            <DataCardList
              rows={paginatedRows}
              fields={[
                { key: 'username', label: 'اسم المستخدم' },
                { key: 'name', label: 'الاسم' },
                { key: 'role', label: 'الدور', format: (v) => getRoleLabel(v) },
                { key: 'active', label: 'الحالة', format: (v) => v ? 'مفعّل' : 'معطّل' },
              ]}
              actions={(u) => (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => startEdit(u)}>تعديل</button>
                  <button className="btn btn-sm" onClick={() => setToggleTarget(u.id)} style={{ background: u.active ? '#dcfce7' : '#fee2e2', color: u.active ? '#16a34a' : '#dc2626', border: 'none' }}>
                    {u.active ? 'تعطيل' : 'تفعيل'}
                  </button>
                  {u.username !== 'admin' && <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(u.id)}>حذف</button>}
                </>
              )}
            />

            {/* Pagination */}
            <Pagination
              page={page}
              totalPages={totalPages}
              totalRows={totalRows}
              perPage={perPage}
              onPageChange={goTo}
              onPerPageChange={setPerPage}
            />
          </div>
        </>
      )}

      {/* ===================== Tab 2: Bonus Settings ===================== */}
      {activeTab === 'bonus' && (
        <>
          {/* Global Bonus Settings */}
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>إعدادات العمولة</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>عمولة ثابتة للبائع (لكل توصيلة مؤكدة)</label>
                <input {...numberInputProps} min="0" step="any" value={settingsForm.seller_bonus_fixed} onChange={(e) => setSettingsForm({ ...settingsForm, seller_bonus_fixed: e.target.value })} />
              </div>
              <div className="form-group">
                <label>نسبة البائع من فرق السعر (%)</label>
                <input {...numberInputProps} min="0" max="100" value={settingsForm.seller_bonus_percentage} onChange={(e) => setSettingsForm({ ...settingsForm, seller_bonus_percentage: e.target.value })} />
              </div>
              <div className="form-group">
                <label>عمولة ثابتة للسائق (لكل توصيلة مؤكدة)</label>
                <input {...numberInputProps} min="0" step="any" value={settingsForm.driver_bonus_fixed} onChange={(e) => setSettingsForm({ ...settingsForm, driver_bonus_fixed: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => setConfirmSettings(true)} style={{ marginTop: '12px' }}>حفظ الإعدادات</button>
          </div>

          {/* Per-category bonus rates — same formula, one rate row per category */}
          <div className="card" style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px' }}>معدلات العمولة حسب الفئة</h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '12px' }}>
              نفس طريقة الحساب، لكن لكل فئة معدّلها الخاص. الحقل الفارغ = استخدام الإعدادات العامة أعلاه.
              مفيد لجعل عمولة الإكسسوارات/قطع التبديل أقل من سعرها.
            </p>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الفئة</th>
                    <th>ثابت بائع</th>
                    <th>نسبة بائع %</th>
                    <th>ثابت سائق</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCT_CATEGORIES.map((cat) => {
                    const v = categoryForm[cat] || {};
                    const hasRow = (categoryRates || []).some((r) => r.category === cat);
                    return (
                      <tr key={cat}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{cat}</td>
                        <td><input {...numberInputProps} min="0" step="any" style={{ width: 90 }}
                          placeholder={settingsForm.seller_bonus_fixed}
                          value={v.seller_fixed ?? ''}
                          onChange={(e) => setCatField(cat, 'seller_fixed', e.target.value)} /></td>
                        <td><input {...numberInputProps} min="0" max="100" style={{ width: 90 }}
                          placeholder={settingsForm.seller_bonus_percentage}
                          value={v.seller_percentage ?? ''}
                          onChange={(e) => setCatField(cat, 'seller_percentage', e.target.value)} /></td>
                        <td><input {...numberInputProps} min="0" step="any" style={{ width: 90 }}
                          placeholder={settingsForm.driver_bonus_fixed}
                          value={v.driver_fixed ?? ''}
                          onChange={(e) => setCatField(cat, 'driver_fixed', e.target.value)} /></td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => handleSaveCategoryRate(cat)} disabled={savingRates}>حفظ</button>
                          {hasRow && <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => handleResetCategoryRate(cat)}>إعادة</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* v1.1 F-007 — per-user bonus rate overrides */}
          <div className="card" style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>
              معدلات عمولة مخصصة لكل مستخدم
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
                      <th>الدور</th>
                      <th>العمولة الثابتة (لكل قطعة)</th>
                      <th>نسبة فرق السعر %</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonusRates.map((r) => {
                      const user = safeUsers.find((u) => u.username === r.username);
                      return (
                        <tr key={r.username}>
                          <td style={{ fontWeight: 600 }}>{user?.name || r.username}</td>
                          <td>{(() => {
                            const u = safeUsers.find(u2 => u2.username === r.username);
                            return u?.role === 'seller' ? 'بائع' : u?.role === 'driver' ? 'سائق' : u?.role || '—';
                          })()}</td>
                          <td className="number-cell">{(() => {
                            const u = safeUsers.find(u2 => u2.username === r.username);
                            if (u?.role === 'seller') return r.seller_fixed != null ? `${parseFloat(r.seller_fixed)} €` : '—';
                            if (u?.role === 'driver') return r.driver_fixed != null ? `${parseFloat(r.driver_fixed)} €` : '—';
                            return '—';
                          })()}</td>
                          <td className="number-cell">{(() => {
                            const u = safeUsers.find(u2 => u2.username === r.username);
                            if (u?.role === 'seller') return r.seller_percentage != null ? `${parseFloat(r.seller_percentage)}%` : '—';
                            return '—';
                          })()}</td>
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
                {/* v1.2 fix — show only relevant fields per role.
                    Sellers see: seller fixed + seller percentage.
                    Drivers see: driver fixed only. */}
                {(() => {
                  const selectedUser = [...overridableUsers, ...(Array.isArray(bonusRates) ? bonusRates : [])].find(u => u.username === (editingRate || rateForm.username));
                  const role = selectedUser?.role;
                  if (!role) return (
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>اختر مستخدم أولاً لعرض الحقول المناسبة</p>
                    </div>
                  );
                  if (role === 'seller') return (<>
                    <div className="form-group">
                      <label>عمولة البائع الثابتة (€) — لكل قطعة</label>
                      <input {...numberInputProps} min="0" step="any" placeholder={settingsForm.seller_bonus_fixed}
                        value={rateForm.seller_fixed} onChange={(e) => setRateForm({ ...rateForm, seller_fixed: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>نسبة البائع من فرق السعر (%)</label>
                      <input {...numberInputProps} min="0" max="100" placeholder={settingsForm.seller_bonus_percentage}
                        value={rateForm.seller_percentage} onChange={(e) => setRateForm({ ...rateForm, seller_percentage: e.target.value })} />
                    </div>
                  </>);
                  if (role === 'driver') return (
                    <div className="form-group">
                      <label>عمولة السائق الثابتة (€) — لكل قطعة</label>
                      <input {...numberInputProps} min="0" step="any" placeholder={settingsForm.driver_bonus_fixed}
                        value={rateForm.driver_fixed} onChange={(e) => setRateForm({ ...rateForm, driver_fixed: e.target.value })} />
                    </div>
                  );
                  return null;
                })()}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button className="btn btn-primary btn-sm" onClick={handleSaveRate} disabled={savingRates}>
                  {savingRates ? 'جارٍ الحفظ…' : (editingRate ? 'تحديث' : 'إضافة')}
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

          {/* Per-user × per-category overrides (most specific layer) */}
          <div className="card" style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px' }}>معدلات المستخدم حسب الفئة</h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '12px' }}>
              معدّل خاص لمستخدم في فئة معيّنة (الأكثر تحديداً). اترك الحقل فارغاً ليرث القيمة الافتراضية —{' '}
              <strong>الرقم الباهت داخل الحقل هو القيمة المطبَّقة حالياً</strong> (معدّل الفئة، وإلا الإعداد العام).
              املأ فقط ما تريد تخصيصه ثم اضغط «حفظ».
            </p>
            <div className="form-group" style={{ maxWidth: 360, marginBottom: 12 }}>
              <label>المستخدم</label>
              <select value={ucSelectedUser} onChange={(e) => loadUserCatRates(e.target.value)}>
                <option value="">-- اختر بائعاً أو سائقاً --</option>
                {safeUsers.filter((u) => u.role === 'seller' || u.role === 'driver').map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.name || u.username} ({u.role === 'seller' ? 'بائع' : 'سائق'})
                  </option>
                ))}
              </select>
            </div>
            {ucSelectedUser && (() => {
              const u = safeUsers.find((x) => x.username === ucSelectedUser);
              const isSel = u?.role === 'seller';
              const isDrv = u?.role === 'driver';
              return (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>الفئة</th>
                        {isSel && <th>ثابت بائع</th>}
                        {isSel && <th>نسبة بائع %</th>}
                        {isDrv && <th>ثابت سائق</th>}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {PRODUCT_CATEGORIES.map((cat) => {
                        const v = ucForm[cat] || {};
                        // Placeholder = the value inherited if this field is left blank
                        // (the category rate if set, otherwise the global default).
                        const cr = (categoryRates || []).find((r) => r.category === cat) || {};
                        const phSeller = cr.seller_fixed ?? settingsForm.seller_bonus_fixed;
                        const phPct = cr.seller_percentage ?? settingsForm.seller_bonus_percentage;
                        const phDriver = cr.driver_fixed ?? settingsForm.driver_bonus_fixed;
                        const hasRow = (ucRows || []).some((r) => r.category === cat);
                        return (
                          <tr key={cat}>
                            <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{cat}</td>
                            {isSel && <td><input {...numberInputProps} min="0" step="any" style={{ width: 110 }}
                              placeholder={phSeller}
                              value={v.seller_fixed ?? ''}
                              onChange={(e) => setUcField(cat, 'seller_fixed', e.target.value)} /></td>}
                            {isSel && <td><input {...numberInputProps} min="0" max="100" style={{ width: 110 }}
                              placeholder={phPct}
                              value={v.seller_percentage ?? ''}
                              onChange={(e) => setUcField(cat, 'seller_percentage', e.target.value)} /></td>}
                            {isDrv && <td><input {...numberInputProps} min="0" step="any" style={{ width: 110 }}
                              placeholder={phDriver}
                              value={v.driver_fixed ?? ''}
                              onChange={(e) => setUcField(cat, 'driver_fixed', e.target.value)} /></td>}
                            <td style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => handleSaveUserCatRate(cat)} disabled={savingRates}>حفظ</button>
                              {hasRow && <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => handleResetUserCatRate(cat)}>إزالة</button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}

      <ConfirmModal isOpen={!!deleteId} title="حذف مستخدم" message="هل أنت متأكد؟ لا يمكن التراجع." onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
      {/* v1.1 F-017 — confirmation gates for previously one-click destructive actions */}
      <ConfirmModal
        isOpen={!!toggleTarget}
        title="تغيير حالة المستخدم"
        message="هل أنت متأكد من تغيير حالة هذا المستخدم (تفعيل / تعطيل)؟"
        confirmText="نعم، تغيير"
        confirmClass="btn-primary"
        onConfirm={() => handleToggle(toggleTarget)}
        onCancel={() => setToggleTarget(null)}
      />
      <ConfirmModal
        isOpen={confirmSettings}
        title="حفظ إعدادات العمولة"
        message="سيتم تحديث إعدادات العمولة لجميع المبيعات المستقبلية. هل أنت متأكد؟"
        confirmText="نعم، حفظ"
        confirmClass="btn-primary"
        onConfirm={handleSaveSettings}
        onCancel={() => setConfirmSettings(false)}
      />
    </AppLayout>
  );
}

export default function UsersPage() {
  return <ToastProvider><UsersContent /></ToastProvider>;
}
