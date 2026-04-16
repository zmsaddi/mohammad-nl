'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
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

  // Item 3 — click-to-sort, default newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    rows,
    { key: 'date', direction: 'desc' }
  );

  const startEditExpense = (row) => {
    setEditExpense(row);
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

      {/* Add Form */}
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
            {editExpense && (
              <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                إلغاء التعديل
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Data Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المصاريف ({rows.length}) - الإجمالي: {formatNumber(totalExpenses)}
          </h3>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد مصاريف بعد</h3>
            <p>أضف أول مصروف من النموذج أعلاه</p>
          </div>
        ) : (
          <div className="table-container">
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
                {sortedRows.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td>{row.id}</td>
                    <td>{row.date}</td>
                    <td><span className="status-badge status-credit">{row.category}</span></td>
                    <td>{row.description}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.amount)}</td>
                    <td><span className="status-badge" style={{ background: row.payment_type === 'بنك' ? '#dbeafe' : '#dcfce7', color: row.payment_type === 'بنك' ? '#1e40af' : '#16a34a' }}>{row.payment_type || 'كاش'}</span></td>
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
        )}
      </div>

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
