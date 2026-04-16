'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import Pagination, { usePagination } from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { formatNumber, getTodayDate, EXPENSE_CATEGORIES } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';

function ExpensesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [editExpense, setEditExpense] = useState(null);
  const [showForm, setShowForm] = useState(false);

  // UX-05: filter states
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

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
      const res = await fetch('/api/expenses', { cache: 'no-store' });
      const data = await res.json();
      setRows(Array.isArray(data) ? data.reverse() : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  // UX-05: filter pipeline
  const filtered = rows.filter((r) => {
    if (filterDateFrom && r.date < filterDateFrom) return false;
    if (filterDateTo && r.date > filterDateTo) return false;
    if (filterCategory && r.category !== filterCategory) return false;
    if (filterSearch && !(r.description || '').toLowerCase().includes(filterSearch.toLowerCase())) return false;
    return true;
  });

  // Item 3 — click-to-sort, default newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'date', direction: 'desc' }
  );

  // PA-03: pagination
  const { paginatedRows, page, totalPages, totalRows, perPage, setPerPage, goTo } = usePagination(sortedRows);

  const startEditExpense = (row) => {
    setEditExpense(row);
    setShowForm(true);
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
            category: form.category,
            description: form.description,
            amount: form.amount,
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
                <input id="exp-amount" type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" required />
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
            سجل المصاريف ({sortedRows.length}/{rows.length}) - الإجمالي: {formatNumber(totalExpenses)}
          </h3>
          {!showForm && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
              + مصروف جديد
            </button>
          )}
        </div>

        {/* UX-05: filter bar */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.85rem' }}>
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} title="من تاريخ" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} title="إلى تاريخ" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }}
          >
            <option value="">كل الفئات</option>
            {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="بحث بالوصف..."
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px', minWidth: '140px' }}
          />
          {(filterDateFrom || filterDateTo || filterCategory || filterSearch) && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterCategory(''); setFilterSearch(''); }}
            >
              ✕ مسح
            </button>
          )}
        </div>

        {loading ? (
          <PageSkeleton rows={6} />
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>{rows.length === 0 ? 'لا توجد مصاريف بعد' : 'لا توجد نتائج'}</h3>
            <p>{rows.length === 0 ? 'أضف أول مصروف من الزر أعلاه' : 'جرّب تعديل الفلاتر'}</p>
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
      <ExpensesContent />
    </ToastProvider>
  );
}
