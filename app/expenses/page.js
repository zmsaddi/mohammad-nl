'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import ErrorState from '@/components/ErrorState';
import FilterSheet from '@/components/FilterSheet';
import Pagination, { usePagination } from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { formatNumber, getTodayDate, EXPENSE_CATEGORIES, numberInputProps } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { useUrlFilters } from '@/lib/use-url-filters';
import { matchesText, dateInRange } from '@/lib/filter-engine';

const EXPENSE_FILTERS = { from: { default: '', debounce: 400 }, to: { default: '', debounce: 400 }, category: { default: '' }, q: { default: '', debounce: 300 } };

function ExpensesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [editExpense, setEditExpense] = useState(null);
  const [showForm, setShowForm] = useState(false);

  // UX-05: filter states (URL-synced via the shared hook)
  const { values: f, set: setFilter, reset: resetFilters, isActive: filtersActive } = useUrlFilters(EXPENSE_FILTERS);

  const [form, setForm] = useState({
    date: getTodayDate(),
    category: '',
    description: '',
    amount: '',
    paymentType: 'كاش',
    notes: '',
  });

  const fetchData = async () => {
    try {
      setError(false);
      const res = await fetch('/api/expenses', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError(true);
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  // UX-05: filter pipeline (shared engine)
  const filtered = useMemo(() => rows.filter((r) => {
    if (!dateInRange(r.date, f.from, f.to)) return false;
    if (f.category && r.category !== f.category) return false;
    if (!matchesText([r.description, r.notes], f.q)) return false;
    return true;
  }), [rows, f.from, f.to, f.category, f.q]);

  // Item 3 — click-to-sort, default newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'date', direction: 'desc' }
  );

  // PA-03: pagination
  const { paginatedRows, page, totalPages, totalRows, perPage, setPerPage, goTo, resetPage } = usePagination(sortedRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { resetPage(); }, [f.from, f.to, f.category, f.q]);

  const startEditExpense = (row) => {
    setEditExpense(row);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setForm({
      date: row.date || getTodayDate(),
      category: row.category || '',
      description: row.description || '',
      amount: String(row.amount ?? ''),
      paymentType: row.payment_type || 'كاش',
      notes: row.notes || '',
    });
  };

  const cancelEdit = () => {
    setEditExpense(null);
    setShowForm(false);
    setForm({ date: getTodayDate(), category: '', description: '', amount: '', paymentType: 'كاش', notes: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.category || !form.description || !form.amount) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    setSubmitting(true);
    try {
      if (editExpense) {
        // --- EDIT mode: PUT existing expense ---
        const res = await fetch('/api/expenses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editExpense.id,
            date: form.date,
            category: form.category,
            description: form.description,
            amount: form.amount,
            paymentType: form.paymentType,
            notes: form.notes,
          }),
          cache: 'no-store',
        });
        if (res.ok) {
          addToast('تم تعديل المصروف بنجاح');
          cancelEdit();
          fetchData();
        } else {
          const err = await res.json();
          addToast(err.error || 'خطأ في تعديل البيانات', 'error');
        }
      } else {
        // --- ADD mode: POST new expense ---
        const res = await fetch('/api/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
          cache: 'no-store',
        });
        if (res.ok) {
          addToast('تم إضافة المصروف بنجاح');
          setForm({ date: getTodayDate(), category: '', description: '', amount: '', paymentType: 'كاش', notes: '' });
          setShowForm(false);
          fetchData();
        } else {
          addToast('خطأ في إضافة البيانات', 'error');
        }
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/expenses?id=${deleteId}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) {
        addToast('تم الحذف بنجاح');
        fetchData();
      } else {
        const data = await res.json();
        addToast(data.error || 'خطأ في الحذف', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    }
    setDeleteId(null);
  };

  const totalExpenses = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

  return (
    <AppLayout>
      <div className="page-header">
        <h2>المصاريف</h2>
        <p>مصاريف المتجر والتشغيل</p>
      </div>

      {/* PA-01: Collapsible Add/Edit Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
            {editExpense ? 'تعديل مصروف' : 'إضافة مصروف جديد'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="exp-date">التاريخ *</label>
                <input id="exp-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label htmlFor="exp-category">الفئة *</label>
                <select id="exp-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                  <option value="">اختر الفئة</option>
                  {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="exp-desc">الوصف *</label>
                <input id="exp-desc" type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف المصروف" required />
              </div>
              <div className="form-group">
                <label htmlFor="exp-amount">المبلغ *</label>
                <input id="exp-amount" {...numberInputProps} min="0" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" required />
              </div>
              <div className="form-group">
                <label>وسيلة الدفع</label>
                <div className="radio-group" style={{ marginTop: '6px' }}>
                  <label className="radio-option">
                    <input id="exp-pay-cash" type="radio" name="expPayType" value="كاش" checked={form.paymentType === 'كاش'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                    كاش
                  </label>
                  <label className="radio-option">
                    <input id="exp-pay-bank" type="radio" name="expPayType" value="بنك" checked={form.paymentType === 'بنك'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                    بنك
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="exp-notes">ملاحظات</label>
                <input id="exp-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? (editExpense ? 'جاري التعديل...' : 'جاري الإضافة...') : (editExpense ? 'حفظ التعديلات' : 'إضافة مصروف')}
              </button>
              {editExpense ? (
                <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                  إلغاء التعديل
                </button>
              ) : (
                <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>
                  إلغاء
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Data Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المصاريف ({filtered.length === rows.length ? rows.length : `${filtered.length} من ${rows.length}`}) - الإجمالي: {formatNumber(totalExpenses)}
          </h3>
          {!showForm && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
              + مصروف جديد
            </button>
          )}
        </div>

        {/* UX-05: filter bar — wrapped in FilterSheet (mobile bottom sheet; desktop inline). */}
        <FilterSheet
          isActive={filtersActive}
          onClear={resetFilters}
          chips={[
            f.from && { label: `من ${f.from}`, onRemove: () => setFilter('from', '') },
            f.to && { label: `إلى ${f.to}`, onRemove: () => setFilter('to', '') },
            f.category && { label: f.category, onRemove: () => setFilter('category', '') },
            f.q && { label: `بحث: ${f.q}`, onRemove: () => setFilter('q', '') },
          ].filter(Boolean)}
        >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.85rem' }}>
          <input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} aria-label="من تاريخ" className="filter-control" />
          <input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} aria-label="إلى تاريخ" className="filter-control" />
          <select
            value={f.category}
            onChange={(e) => setFilter('category', e.target.value)}
            aria-label="تصفية حسب الفئة"
            className="filter-control"
          >
            <option value="">كل الفئات</option>
            {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <input
            type="text"
            value={f.q}
            onChange={(e) => setFilter('q', e.target.value)}
            aria-label="بحث في المصاريف"
            placeholder="بحث بالوصف..."
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px', minWidth: '140px' }}
          />
          {filtersActive && (
            <button type="button" className="btn btn-outline btn-sm" onClick={resetFilters}>
              ✕ مسح
            </button>
          )}
        </div>
        </FilterSheet>

        {loading ? (
          <PageSkeleton rows={6} />
        ) : error ? (
          <ErrorState onRetry={fetchData} />
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>{rows.length === 0 ? 'لا توجد مصاريف بعد' : 'لا توجد نتائج مطابقة'}</h3>
            <p>{rows.length === 0 ? 'أضف أول مصروف من الزر أعلاه' : 'جرّب تعديل الفلاتر أو مسحها'}</p>
            {rows.length > 0 && filtersActive && (
              <button className="btn btn-sm btn-clear" style={{ marginTop: 8 }} onClick={resetFilters}>✕ مسح الفلاتر</button>
            )}
          </div>
        ) : (
          <>
          {/* PA-02: mobile card fallback */}
          <DataCardList
            rows={paginatedRows}
            fields={[
              { key: 'date', label: 'التاريخ' },
              { key: 'category', label: 'الفئة' },
              { key: 'description', label: 'الوصف' },
              { key: 'amount', label: 'المبلغ', format: (v) => `${formatNumber(v)} €` },
              { key: 'payment_type', label: 'الدفع', format: (v) => v || 'كاش' },
            ]}
            actions={(row) => (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => setSelectedRow(row)}>تفاصيل</button>
                {isAdmin && (
                  <>
                    <button className="btn btn-outline btn-sm" onClick={() => startEditExpense(row)}>تعديل</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>حذف</button>
                  </>
                )}
              </>
            )}
            emptyMessage="لا توجد مصاريف"
          />
          {/* Desktop table: hidden below 768px when card fallback is active */}
          <div className="table-container has-card-fallback">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('id')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('id')}>#{getSortIndicator('id')}</th>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('date')}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('category')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('category')}>الفئة{getSortIndicator('category')}</th>
                  <th onClick={() => requestSort('description')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('description')}>الوصف{getSortIndicator('description')}</th>
                  <th onClick={() => requestSort('amount')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('amount')}>المبلغ{getSortIndicator('amount')}</th>
                  <th onClick={() => requestSort('payment_type')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('payment_type')}>الدفع{getSortIndicator('payment_type')}</th>
                  <th>ملاحظات</th>
                  {isAdmin && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td>{row.id}</td>
                    <td>{row.date}</td>
                    <td><span className="status-badge status-credit">{row.category}</span></td>
                    <td>{row.description}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.amount)}</td>
                    <td><StatusBadge status={row.payment_type || 'كاش'} /></td>
                    <td>{row.notes}</td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); startEditExpense(row); }}>
                            تعديل
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>
                            حذف
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* PA-03: pagination */}
          <Pagination
            page={page}
            totalPages={totalPages}
            totalRows={totalRows}
            perPage={perPage}
            onPageChange={goTo}
            onPerPageChange={setPerPage}
          />
          </>
        )}
      </div>

      {/* PA-05: cross-navigation */}
      <div className="cross-nav"><a href="/purchases">المشتريات &rarr;</a></div>

      <DetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `مصروف #${selectedRow.id}` : ''}
        fields={selectedRow ? [
          { label: 'التاريخ', value: selectedRow.date },
          { label: 'الفئة', type: 'badge', value: selectedRow.category, bg: '#fef3c7', color: '#d97706' },
          { label: 'الوصف', value: selectedRow.description },
          { type: 'divider' },
          { label: 'المبلغ', type: 'money', value: selectedRow.amount },
          { label: 'وسيلة الدفع', type: 'badge', value: selectedRow.payment_type || 'كاش', bg: selectedRow.payment_type === 'بنك' ? '#dbeafe' : '#dcfce7', color: selectedRow.payment_type === 'بنك' ? '#1e40af' : '#16a34a' },
          ...(selectedRow.created_by ? [{ label: 'بواسطة', value: selectedRow.created_by }] : []),
          ...(selectedRow.notes ? [{ label: 'ملاحظات', value: selectedRow.notes }] : []),
        ] : []}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف مصروف"
        message="هل أنت متأكد من حذف هذا المصروف؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AppLayout>
  );
}

export default function ExpensesPage() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <ExpensesContent />
      </Suspense>
    </ToastProvider>
  );
}
