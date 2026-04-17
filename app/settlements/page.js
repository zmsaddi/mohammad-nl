'use client';

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber, getTodayDate } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import Pagination, { usePagination } from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';

// v1.1 S1.8 — `profit_distribution` deprecated from this form. Legacy rows
// with this type still exist in the settlements table (pre-v1.1 data); we
// keep the display entry so the history table can render their label, but
// FORM_TYPES (used by the new-settlement <select>) excludes it. New profit
// splits must go through /profit-distributions.
const TYPES = {
  seller_payout:       { label: 'دفع عمولة بائع',  color: '#16a34a', bg: '#dcfce7' },
  driver_payout:       { label: 'دفع عمولة سائق',  color: '#7c3aed', bg: '#ede9fe' },
  profit_distribution: { label: 'توزيع أرباح (قديم — استخدم /profit-distributions)', color: '#1e40af', bg: '#dbeafe' },
};
const FORM_TYPES = {
  seller_payout: TYPES.seller_payout,
  driver_payout: TYPES.driver_payout,
};

function SettlementsContent() {
  const addToast = useToast();
  const [settlements, setSettlements] = useState([]);
  const [bonuses, setBonuses] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // v1.0.1 Feature 3 — eligible-users list for the currently selected
  // settlement type. Refetched every time the type changes.
  const [eligibleUsers, setEligibleUsers] = useState([]);

  // v1.0.1 Feature 2 — details modal state. When set, a modal shows the
  // full drill-down for the clicked settlement.
  const [detailsState, setDetailsState] = useState(null); // { loading, data }

  const [form, setForm] = useState({
    date: getTodayDate(),
    type: 'seller_payout',
    username: '',
    description: '',
    amount: '',
    notes: '',
  });

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

  // v1.0.1 Feature 3 — reload eligible users whenever the form type changes
  const fetchEligible = async (type) => {
    try {
      const res = await fetch(`/api/users/eligible-for-settlement?type=${type}`, { cache: 'no-store' });
      const data = await res.json();
      setEligibleUsers(Array.isArray(data) ? data : []);
    } catch {
      setEligibleUsers([]);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);
  useEffect(() => { fetchEligible(form.type); }, [form.type]);

  // Find the currently-selected user's live credit from eligibleUsers.
  // For profit_distribution the credit is null (no strict cap).
  const selectedUser = eligibleUsers.find((u) => u.username === form.username);
  const availableCredit = selectedUser?.available_credit;
  const amountNum = parseFloat(form.amount) || 0;
  // Feature 1 — live validation: allow 1 cent tolerance to match backend.
  const exceedsCredit = availableCredit !== null &&
                        availableCredit !== undefined &&
                        amountNum > availableCredit + 0.01;

  // Item 3 — click-to-sort on the settlements history table, default newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    Array.isArray(settlements) ? settlements : [],
    { key: 'date', direction: 'desc' }
  );
  // PA-03: Pagination
  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows } = usePagination(sortedRows);

  // Calculate unsettled bonuses per user — ARC-06: parseFloat for NUMERIC.
  const unsettledByUser = {};
  (Array.isArray(bonuses) ? bonuses : []).filter((b) => !b.settled).forEach((b) => {
    if (!unsettledByUser[b.username]) unsettledByUser[b.username] = { total: 0, count: 0, role: b.role };
    unsettledByUser[b.username].total += parseFloat(b.total_bonus) || 0;
    unsettledByUser[b.username].count += 1;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.description || !form.amount) {
      addToast('الوصف والمبلغ مطلوبين', 'error');
      return;
    }
    if (exceedsCredit) {
      addToast('المبلغ يتجاوز الرصيد المتاح', 'error');
      return;
    }
    // v1.2 — re-validate available_credit right before commit. Pre-v1.2
    // the UI fetched eligibleUsers once on mount/type-change, so another
    // admin settling a bonus in parallel made the cached credit stale —
    // the form showed "green" while the backend rejected with "يتجاوز
    // الرصيد". Now we refresh and compare; if the credit dropped below
    // the amount the user typed, we stop and surface the fresh number
    // instead of sending a request that will fail server-side anyway.
    if (form.type === 'seller_payout' || form.type === 'driver_payout') {
      try {
        const res = await fetch(`/api/users/eligible-for-settlement?type=${form.type}`, { cache: 'no-store' });
        const fresh = await res.json();
        const freshUser = (Array.isArray(fresh) ? fresh : []).find((u) => u.username === form.username);
        const freshCredit = freshUser?.available_credit;
        if (freshCredit != null && amountNum > freshCredit + 0.01) {
          setEligibleUsers(Array.isArray(fresh) ? fresh : []);
          addToast(`الرصيد تغيّر — المتاح الآن ${freshCredit.toFixed(2)}€ فقط`, 'error');
          return;
        }
      } catch { /* fall through — backend is still the hard gate */ }
    }
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم تسجيل التسوية');
        setForm({ date: getTodayDate(), type: 'seller_payout', username: '', description: '', amount: '', notes: '' });
        setShowForm(false);
        fetchData();
      } else {
        const d = await res.json();
        addToast(d.error || 'خطأ', 'error');
      }
    } catch { addToast('خطأ', 'error'); }
  };

  // v1.0.1 Feature 3 + 4 — when the user picks a recipient, auto-fill
  // amount with their available credit and pre-fill a sensible
  // description. They can still edit both before submit.
  const handleUserChange = (username) => {
    const user = eligibleUsers.find((u) => u.username === username);
    setForm((prev) => {
      const next = { ...prev, username };
      // Auto-fill amount (Feature 4). Null means profit_distribution
      // with no strict cap — leave amount empty for manual entry.
      if (user?.available_credit != null && user.available_credit > 0.005) {
        next.amount = user.available_credit.toFixed(2);
      } else if (user?.available_credit != null) {
        // Zero credit — still let them pick, but blank the amount
        next.amount = '';
      }
      // Auto-fill description from the user's real name
      if (user && !prev.description) {
        const roleLabel = prev.type === 'seller_payout' ? 'بائع'
          : prev.type === 'driver_payout' ? 'سائق'
          : 'إدارة';
        next.description = `تسوية ${roleLabel} — ${user.name || username}`;
      }
      return next;
    });
  };

  const handleTypeChange = (type) => {
    setForm((prev) => ({
      ...prev,
      type,
      username: '',
      amount: '',
      description: '',
    }));
  };

  const handleQuickSettle = (username, total) => {
    const role = unsettledByUser[username]?.role;
    const type = role === 'driver' ? 'driver_payout' : 'seller_payout';
    // Open the form with the type pre-set; the useEffect above refetches
    // eligibleUsers for this type, then we fill username + amount.
    setForm({
      date: getTodayDate(),
      type,
      username,
      description: '',
      amount: String(Math.round(total * 100) / 100),
      notes: '',
    });
    setShowForm(true);
  };

  // v1.0.1 Feature 2 — open the drill-down modal for a specific settlement
  const openDetails = async (settlementId) => {
    setDetailsState({ loading: true, data: null });
    try {
      const res = await fetch(`/api/settlements/${settlementId}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setDetailsState({ loading: false, data });
      } else {
        addToast('خطأ في جلب التفاصيل', 'error');
        setDetailsState(null);
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
      setDetailsState(null);
    }
  };

  return (
    <AppLayout>
      <div className="page-header">
        <h2>التسويات</h2>
        <p>تسوية حسابات البائعين والسائقين وتوزيع الأرباح</p>
      </div>

      {/* Unsettled Bonuses */}
      {Object.keys(unsettledByUser).length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#dc2626' }}>عمولات مستحقة (غير مسوّاة)</h3>
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

      {/* Settlement Form — v1.0.1 Features 1/3/4 */}
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
                <select value={form.type} onChange={(e) => handleTypeChange(e.target.value)}>
                  {Object.entries(FORM_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>المستخدم *</label>
                {/* v1.0.1 Feature 3 — filtered by role per selected type.
                    Users with zero credit are kept in the list but marked
                    "لا يوجد رصيد" so the admin sees the full roster. */}
                <select value={form.username} onChange={(e) => handleUserChange(e.target.value)} required>
                  <option value="">-- اختر --</option>
                  {eligibleUsers.map((u) => {
                    const hasCredit = u.available_credit == null || u.available_credit > 0.005;
                    const suffix = u.available_credit == null
                      ? ''
                      : hasCredit
                      ? ` — ${u.available_credit.toFixed(2)}€`
                      : ' — لا يوجد رصيد';
                    return (
                      <option
                        key={u.username}
                        value={u.username}
                        style={{ color: hasCredit ? '#1a1a1a' : '#94a3b8' }}
                      >
                        {u.name || u.username}{suffix}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="form-group">
                <label>المبلغ *</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                  style={{
                    border: exceedsCredit ? '2px solid #dc2626' : undefined,
                    background: exceedsCredit ? '#fef2f2' : undefined,
                  }}
                />
                {/* v1.0.1 Feature 1 — live available-credit display */}
                {availableCredit != null && form.username && (
                  <div style={{
                    marginTop: '6px',
                    fontSize: '0.78rem',
                    color: exceedsCredit ? '#dc2626' : '#16a34a',
                    fontWeight: 600,
                  }}>
                    الرصيد المتاح: {availableCredit.toFixed(2)}€
                    {exceedsCredit && ' — المبلغ يتجاوز الرصيد!'}
                  </div>
                )}
                {availableCredit === null && form.username && (
                  <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#64748b' }}>
                    توزيع الأرباح — لا يوجد حد أعلى
                  </div>
                )}
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
              <button
                type="submit"
                className="btn btn-primary"
                disabled={exceedsCredit}
              >
                تسجيل التسوية
              </button>
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
        {loading ? <PageSkeleton rows={6} showStats={false} /> : (
          !Array.isArray(settlements) || settlements.length === 0 ? (
            <div className="empty-state"><h3>لا توجد تسويات</h3></div>
          ) : (
            <>
            {/* PA-02: mobile card fallback */}
            <DataCardList
              rows={paginatedRows}
              fields={[
                { key: 'date', label: 'التاريخ' },
                { key: 'type', label: 'النوع', format: (v) => TYPES[v]?.label || v },
                { key: 'username', label: 'المستخدم' },
                { key: 'description', label: 'الوصف' },
                { key: 'amount', label: 'المبلغ', format: (v) => `${formatNumber(v)} €` },
                { key: 'notes', label: 'ملاحظات' },
              ]}
              actions={(row) => (
                <button className="btn btn-outline btn-sm" onClick={() => openDetails(row.id)}>تفاصيل</button>
              )}
            />
            {/* Desktop table */}
            <div className="table-container has-card-fallback">
              <table className="data-table">
                <thead><tr>
                  <th onClick={() => requestSort('id')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('id')}>#{getSortIndicator('id')}</th>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('date')}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('type')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('type')}>النوع{getSortIndicator('type')}</th>
                  <th onClick={() => requestSort('username')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('username')}>المستخدم{getSortIndicator('username')}</th>
                  <th onClick={() => requestSort('description')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('description')}>الوصف{getSortIndicator('description')}</th>
                  <th onClick={() => requestSort('amount')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('amount')}>المبلغ{getSortIndicator('amount')}</th>
                  <th onClick={() => requestSort('settled_by')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('settled_by')}>بواسطة{getSortIndicator('settled_by')}</th>
                  <th>ملاحظات</th>
                  <th>التفاصيل</th>
                </tr></thead>
                <tbody>
                  {paginatedRows.map((s) => {
                    const t = TYPES[s.type];
                    return (
                      <tr key={s.id}>
                        <td>{s.id}</td>
                        <td>{s.date}</td>
                        <td><StatusBadge status={t?.label || s.type} bg={t?.bg} color={t?.color} /></td>
                        <td style={{ fontWeight: 600 }}>{s.username || '-'}</td>
                        <td>{s.description}</td>
                        <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(s.amount)}</td>
                        <td>{s.settled_by}</td>
                        <td>{s.notes}</td>
                        <td>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openDetails(s.id)}
                          >
                            تفاصيل
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalRows={totalRows}
              perPage={perPage}
              onPageChange={goTo}
              onPerPageChange={setPerPage}
            />
            </>
          )
        )}
      </div>

      {/* v1.0.1 Feature 2 — drill-down modal */}
      {detailsState && (
        <div
          className="modal-overlay"
          onClick={() => setDetailsState(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px',
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '800px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>تفاصيل التسوية</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setDetailsState(null)}>✕</button>
            </div>
            {detailsState.loading && <div className="loading-overlay"><div className="spinner"></div></div>}
            {detailsState.data && (
              <>
                {/* Header card — settlement summary */}
                <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.9rem' }}>
                    <div><strong>المستخدم:</strong> {detailsState.data.username || '—'}</div>
                    <div><strong>النوع:</strong> {TYPES[detailsState.data.type]?.label || detailsState.data.type}</div>
                    <div><strong>التاريخ:</strong> {detailsState.data.date}</div>
                    <div><strong>المبلغ:</strong> {formatNumber(detailsState.data.amount)}€</div>
                    <div><strong>بواسطة:</strong> {detailsState.data.settled_by}</div>
                    <div><strong>الوصف:</strong> {detailsState.data.description}</div>
                    {detailsState.data.notes && (
                      <div style={{ gridColumn: 'span 2' }}><strong>ملاحظات:</strong> {detailsState.data.notes}</div>
                    )}
                  </div>
                </div>

                {/* Linked items table — bonuses/sales covered by this settlement */}
                <h4 style={{ fontSize: '0.95rem', marginBottom: '8px', color: '#374151' }}>
                  العمليات المرتبطة ({detailsState.data.linked_items?.length || 0})
                </h4>
                {(!detailsState.data.linked_items || detailsState.data.linked_items.length === 0) ? (
                  <div className="empty-state" style={{ padding: '16px' }}>
                    <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      {detailsState.data.type === 'profit_distribution'
                        ? 'توزيع أرباح لا يرتبط بعمليات محددة'
                        : 'لا توجد عمليات مرتبطة بهذه التسوية'}
                    </p>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>التاريخ</th>
                          <th>الطلب</th>
                          <th>العميل</th>
                          <th>المنتج</th>
                          <th>إجمالي البيع</th>
                          <th>العمولة</th>
                          <th>الفاتورة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailsState.data.linked_items.map((it) => (
                          <tr key={it.bonus_id}>
                            <td>{it.bonus_id}</td>
                            <td>{it.bonus_date}</td>
                            <td>#{it.sale_id || '—'}</td>
                            <td>{it.client_name}</td>
                            <td>{it.sale_item}</td>
                            <td className="number-cell">{formatNumber(it.sale_total)}</td>
                            <td className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>
                              {formatNumber(it.total_bonus)}
                            </td>
                            <td>
                              {it.invoice_ref_code ? (
                                <button
                                  className="btn btn-sm"
                                  style={{ background: '#1a3a2a', color: 'white', padding: '4px 8px' }}
                                  onClick={() => window.open(`/api/invoices/${it.invoice_ref_code}/pdf`, '_blank')}
                                >
                                  📄
                                </button>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'left', fontWeight: 700 }}>
                            إجمالي العمولات المسوّاة:
                          </td>
                          <td className="number-cell" style={{ fontWeight: 700, color: '#16a34a' }}>
                            {formatNumber(detailsState.data.linked_total || 0)}
                          </td>
                          <td></td>
                        </tr>
                        {Math.abs((detailsState.data.linked_total || 0) - (detailsState.data.amount || 0)) > 0.01 && (
                          <tr>
                            <td colSpan="6" style={{ textAlign: 'left', fontSize: '0.78rem', color: '#b45309' }}>
                              ⚠️ الفرق عن مبلغ التسوية:
                            </td>
                            <td className="number-cell" style={{ fontSize: '0.78rem', color: '#b45309' }}>
                              {formatNumber((detailsState.data.amount || 0) - (detailsState.data.linked_total || 0))}
                            </td>
                            <td></td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}

export default function SettlementsPage() {
  return <ToastProvider><SettlementsContent /></ToastProvider>;
}
