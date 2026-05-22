'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { formatNumber } from '@/lib/utils';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import PageSkeleton from '@/components/PageSkeleton';
import ErrorState from '@/components/ErrorState';
import DataView from '@/components/DataView';
import Pagination, { usePagination } from '@/components/Pagination';
import { useSortedRows } from '@/lib/use-sorted-rows';
import SortControl from '@/components/SortControl';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { useUrlFilters } from '@/lib/use-url-filters';
import { matchesText } from '@/lib/filter-engine';

const SUPPLIER_FILTERS = { q: { default: '', debounce: 300 } };

function SuppliersContent() {
  const addToast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const { values: f, set: setFilter, reset: resetFilters, isActive: filtersActive } = useUrlFilters(SUPPLIER_FILTERS);
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });

  const fetchData = async () => {
    try {
      setError(false);
      const res = await fetch('/api/suppliers?withDebt=true', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSuppliers(Array.isArray(data) ? data : []);
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

  const filtered = useMemo(
    () => suppliers.filter((s) => matchesText([s.name, s.phone, s.address], f.q)),
    [suppliers, f.q]
  );

  const { sortedRows, requestSort, setSort, sortConfig, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'name', direction: 'asc' }
  );

  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows, resetPage } = usePagination(sortedRows);
  // Snap back to page 1 whenever the filter changes (avoids a stale/empty page).
  // resetPage is a fresh closure each render, so depend only on the filter value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { resetPage(); }, [f.q]);

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
            قائمة الموردين ({filtered.length === suppliers.length ? suppliers.length : `${filtered.length} من ${suppliers.length}`})
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              aria-label="بحث في الموردين"
              placeholder="بحث بالاسم أو الهاتف..."
              value={f.q}
              onChange={(e) => setFilter('q', e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            />
            {filtersActive && (
              <button className="btn btn-sm btn-clear" onClick={resetFilters} style={{ whiteSpace: 'nowrap' }}>✕ مسح</button>
            )}
            {!showForm && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
                + إضافة مورد
              </button>
            )}
          </div>
        </div>

        <SortControl
          fields={[
            { key: 'name', label: 'الاسم' },
            { key: 'remainingDebt', label: 'الدين' },
            { key: 'totalPurchases', label: 'إجمالي المشتريات' },
          ]}
          sortConfig={sortConfig}
          setSort={setSort}
        />

        {loading ? (
          <PageSkeleton rows={5} showStats={false} />
        ) : error ? (
          <ErrorState onRetry={fetchData} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <h3>{filtersActive ? 'لا توجد نتائج مطابقة' : 'لا يوجد موردين بعد'}</h3>
            <p>{filtersActive ? 'جرّب تعديل البحث أو مسح الفلاتر' : 'أضف أول مورد بالضغط على زر الإضافة'}</p>
            {filtersActive ? (
              <button className="btn btn-sm btn-clear" style={{ marginTop: 8 }} onClick={resetFilters}>✕ مسح الفلاتر</button>
            ) : (!showForm && (
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ أضف أول مورد</button>
            ))}
          </div>
        ) : (
          <>
            <DataView
              rows={paginatedRows}
              sort={{ requestSort, getAriaSort, getSortIndicator }}
              onRowClick={(s) => { window.location.href = `/suppliers/${s.id}`; }}
              columns={[
                { key: 'id', label: '#', sortable: true, mobileHide: true },
                { key: 'name', label: 'اسم المورد', sortable: true, cell: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span> },
                { key: 'phone', label: 'الهاتف', sortable: true, cell: (s) => <span style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>{s.phone || '—'}</span> },
                { key: 'totalPurchases', label: 'إجمالي المشتريات', sortable: true, align: 'end', cell: (s) => formatNumber(s.totalPurchases) },
                { key: 'totalPaid', label: 'المدفوع', sortable: true, align: 'end', cell: (s) => <span style={{ color: 'var(--color-success)' }}>{formatNumber(s.totalPaid)}</span> },
                { key: 'remainingDebt', label: 'الدين المتبقي', sortable: true, align: 'end', cell: (s) => <span style={{ color: parseFloat(s.remainingDebt) > 0 ? '#dc2626' : 'var(--color-success)', fontWeight: 600 }}>{formatNumber(s.remainingDebt)}</span> },
              ]}
              actions={(s) => (
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(s.id)}>حذف</button>
              )}
              emptyMessage="لا يوجد موردين"
            />
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
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <SuppliersContent />
      </Suspense>
    </ToastProvider>
  );
}
