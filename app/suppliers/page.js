'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { formatNumber } from '@/lib/utils';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import PageSkeleton from '@/components/PageSkeleton';
import DataCardList from '@/components/DataCardList';
import Pagination, { usePagination } from '@/components/Pagination';
import { useSortedRows } from '@/lib/use-sorted-rows';

function SuppliersContent() {
  const addToast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/suppliers?withDebt=true', { cache: 'no-store' });
      const data = await res.json();
      setSuppliers(Array.isArray(data) ? data : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name) { addToast('يرجى إدخال اسم المورد', 'error'); return; }
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        cache: 'no-store',
      });
      const result = await res.json().catch(() => ({}));
      if (result.ambiguous) {
        addToast(result.message || 'يوجد مورد بنفس الاسم — أضف رقم هاتف للتمييز', 'error');
        return;
      }
      if (res.ok) {
        addToast(result.exists ? 'المورد موجود بالفعل' : 'تم إضافة المورد');
        setForm({ name: '', phone: '', address: '', notes: '' });
        setShowForm(false);
        fetchData();
      } else {
        addToast(result.error || 'خطأ في الإضافة', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/suppliers?id=${deleteId}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) {
        addToast('تم حذف المورد');
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

  const filtered = suppliers.filter((s) =>
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.phone?.includes(search)
  );

  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'name', direction: 'asc' }
  );

  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows } = usePagination(sortedRows);

  return (
    <AppLayout>
      <div className="page-header">
        <h2>الموردين</h2>
        <p>بيانات الموردين المسجلين في النظام</p>
      </div>

      {/* Add Form — collapsible */}
      {showForm ? (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16, color: 'var(--color-text-secondary)' }}>
            إضافة مورد جديد
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="sup-name">اسم المورد *</label>
                <input id="sup-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم المورد" required />
              </div>
              <div className="form-group">
                <label htmlFor="sup-phone">رقم الهاتف</label>
                <input id="sup-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+31612345678" style={{ direction: 'ltr', textAlign: 'right' }} />
              </div>
              <div className="form-group">
                <label htmlFor="sup-address">العنوان</label>
                <input id="sup-address" type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="العنوان" />
              </div>
              <div className="form-group">
                <label htmlFor="sup-notes">ملاحظات</label>
                <input id="sup-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary">إضافة مورد</button>
              <button type="button" className="btn btn-outline" onClick={() => { setShowForm(false); setForm({ name: '', phone: '', address: '', notes: '' }); }}>إلغاء</button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Suppliers Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            قائمة الموردين ({filtered.length})
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="بحث بالاسم أو الهاتف..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            />
            {!showForm && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
                + إضافة مورد
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <PageSkeleton rows={5} showStats={false} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <h3>{search ? 'لا توجد نتائج' : 'لا يوجد موردين بعد'}</h3>
            <p>{search ? 'جرب كلمة بحث مختلفة' : 'أضف أول مورد بالضغط على زر الإضافة'}</p>
            {!search && !showForm && (
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ أضف أول مورد</button>
            )}
          </div>
        ) : (
          <>
            <DataCardList
              rows={paginatedRows}
              fields={[
                { key: 'name', label: 'الاسم' },
                { key: 'phone', label: 'الهاتف' },
                { key: 'totalPurchases', label: 'إجمالي المشتريات', format: (v) => formatNumber(v) },
                { key: 'totalPaid', label: 'المدفوع', format: (v) => formatNumber(v) },
                { key: 'remainingDebt', label: 'الدين المتبقي', format: (v) => formatNumber(v) },
              ]}
              actions={(row) => (
                <>
                  <Link href={`/suppliers/${row.id}`} className="btn btn-primary btn-sm">تفاصيل</Link>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>حذف</button>
                </>
              )}
              emptyMessage="لا يوجد موردين"
            />
            <div className="table-container has-card-fallback">
              <table className="data-table">
                <thead>
                  <tr>
                    <th onClick={() => requestSort('id')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('id')}>#{getSortIndicator('id')}</th>
                    <th onClick={() => requestSort('name')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('name')}>اسم المورد{getSortIndicator('name')}</th>
                    <th onClick={() => requestSort('phone')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('phone')}>الهاتف{getSortIndicator('phone')}</th>
                    <th onClick={() => requestSort('totalPurchases')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('totalPurchases')}>إجمالي المشتريات{getSortIndicator('totalPurchases')}</th>
                    <th onClick={() => requestSort('totalPaid')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('totalPaid')}>المدفوع{getSortIndicator('totalPaid')}</th>
                    <th onClick={() => requestSort('remainingDebt')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('remainingDebt')}>الدين المتبقي{getSortIndicator('remainingDebt')}</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((s) => (
                    <tr key={s.id} className="clickable-row" onClick={() => window.location.href = `/suppliers/${s.id}`}>
                      <td>{s.id}</td>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right' }}>{s.phone || '—'}</td>
                      <td className="number-cell">{formatNumber(s.totalPurchases)}</td>
                      <td className="number-cell" style={{ color: 'var(--color-success)' }}>{formatNumber(s.totalPaid)}</td>
                      <td className="number-cell" style={{ color: parseFloat(s.remainingDebt) > 0 ? '#dc2626' : 'var(--color-success)', fontWeight: 600 }}>{formatNumber(s.remainingDebt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(s.id)}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalRows={totalRows} perPage={perPage} onPageChange={goTo} onPerPageChange={setPerPage} />
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف مورد"
        message="هل أنت متأكد من حذف هذا المورد؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AppLayout>
  );
}

export default function SuppliersPage() {
  return <ToastProvider><SuppliersContent /></ToastProvider>;
}
