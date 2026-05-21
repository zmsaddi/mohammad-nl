'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { useUrlFilters } from '@/lib/use-url-filters';
import { dateInRange } from '@/lib/filter-engine';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import Pagination, { usePagination } from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';

const BONUS_FILTERS = { from: { default: '' }, to: { default: '' }, settled: { default: 'all' } };

function MyBonusContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;

  const [bonuses, setBonuses] = useState([]);
  const [loading, setLoading] = useState(true);

  // UX-09: filter state (URL-synced via the shared hook)
  const { values: f, set: setFilter, reset: resetFilters, isActive: filtersActive } = useUrlFilters(BONUS_FILTERS);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/bonuses', { cache: 'no-store' });
      const data = await res.json();
      setBonuses(Array.isArray(data) ? data : []);
    } catch { addToast('خطأ', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  // Stats — ARC-06: parseFloat on every NUMERIC read so reducers coerce to number.
  const totalAll = bonuses.reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  const unsettled = bonuses.filter((b) => !b.settled).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  const settled = bonuses.filter((b) => b.settled).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  // v1.2 — derive YYYY-MM from today's ISO date to match the format of
  // bonuses.date (stored as TEXT in ISO form). Pre-v1.2 this used
  // `new Date().getFullYear() + getMonth()` which quietly shifted the
  // reference month when the user's local clock crossed midnight UTC
  // but was still "yesterday" locally (or vice-versa). All other date
  // filters on this page use ISO string comparison, so the card now
  // matches that convention.
  const thisMonth = (() => {
    const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
    return bonuses.filter((b) => b.date?.startsWith(ym)).reduce((s, b) => s + (parseFloat(b.total_bonus) || 0), 0);
  })();
  const count = bonuses.length;

  // UX-09: client-side filter pipeline (shared engine)
  const filtered = useMemo(() => bonuses.filter((b) => {
    if (!dateInRange(b.date, f.from, f.to)) return false;
    if (f.settled === 'settled' && !b.settled) return false;
    if (f.settled === 'unsettled' && b.settled) return false;
    return true;
  }), [bonuses, f.from, f.to, f.settled]);

  // Sort: default newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'date', direction: 'desc' }
  );
  // PA-03: Pagination
  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows, resetPage } = usePagination(sortedRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { resetPage(); }, [f.from, f.to, f.settled]);

  return (
    <AppLayout>
      <div className="page-header">
        <h2>العمولة الخاصة بي</h2>
        <p>{role === 'driver' ? 'عمولة التوصيلات المؤكدة' : 'عمولة المبيعات بعد التوصيل'}</p>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards" style={{ marginBottom: '24px' }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>إجمالي العمولة</h3>
            <div className="value" style={{ color: '#16a34a' }}>{formatNumber(totalAll)}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#fef3c7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#f59e0b" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>مستحق (لم يُصرف)</h3>
            <div className="value" style={{ color: '#f59e0b' }}>{formatNumber(unsettled)}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>تم صرفه</h3>
            <div className="value" style={{ color: '#1e40af' }}>{formatNumber(settled)}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#e0e7ff' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#4f46e5" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>هذا الشهر</h3>
            <div className="value" style={{ color: '#4f46e5' }}>{formatNumber(thisMonth)}</div>
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          سجل العمولات ({filtered.length === count ? `${count} عملية` : `${filtered.length} من ${count}`})
        </h3>

        {/* UX-09: Filters */}
        <div className="form-grid" style={{ marginBottom: '16px', gap: '12px' }}>
          <div className="form-group">
            <label>من تاريخ</label>
            <input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} />
          </div>
          <div className="form-group">
            <label>إلى تاريخ</label>
            <input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} />
          </div>
          <div className="form-group">
            <label>الحالة</label>
            <select value={f.settled} onChange={(e) => setFilter('settled', e.target.value)}>
              <option value="all">الكل</option>
              <option value="settled">تم الصرف</option>
              <option value="unsettled">مستحق</option>
            </select>
          </div>
          {filtersActive && (
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-sm" onClick={resetFilters} style={{ background: '#e2e8f0', color: '#334155' }}>✕ مسح الفلاتر</button>
            </div>
          )}
        </div>

        {loading ? (
          <PageSkeleton rows={6} />
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            {bonuses.length === 0 ? (
              <>
                <h3>لا توجد عمولات بعد</h3>
                <p>{role === 'driver' ? 'العمولة تُحسب عند تأكيد التوصيل' : 'العمولة تُحسب بعد تأكيد توصيل المبيعات'}</p>
              </>
            ) : (
              <>
                <h3>لا توجد نتائج مطابقة</h3>
                <p>جرّب تعديل الفلاتر أو مسحها</p>
                <button className="btn btn-sm" style={{ marginTop: 8, background: '#e2e8f0', color: '#334155' }} onClick={resetFilters}>✕ مسح الفلاتر</button>
              </>
            )}
          </div>
        ) : (
          <>
          {/* PA-02: mobile card fallback */}
          <DataCardList
            rows={paginatedRows.map((b) => ({ ...b, _status: b.settled ? 'تم الصرف' : 'مستحق' }))}
            fields={[
              { key: 'date', label: 'التاريخ' },
              { key: 'item', label: 'المنتج' },
              { key: 'quantity', label: 'الكمية' },
              { key: 'fixed_bonus', label: 'ثابت', format: (v) => formatNumber(v) },
              { key: 'total_bonus', label: 'المجموع', format: (v) => `${formatNumber(v)} €` },
            ]}
            statusField="_status"
            statusColors={{ 'تم الصرف': '#16a34a', 'مستحق': '#d97706' }}
            emptyMessage="لا توجد عمولات"
          />
          {/* Desktop table */}
          <div className="table-container has-card-fallback">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('date')}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('item')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('item')}>المنتج{getSortIndicator('item')}</th>
                  <th onClick={() => requestSort('quantity')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('quantity')}>الكمية{getSortIndicator('quantity')}</th>
                  {role === 'seller' && <th onClick={() => requestSort('recommended_price')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('recommended_price')}>السعر الموصى{getSortIndicator('recommended_price')}</th>}
                  {role === 'seller' && <th onClick={() => requestSort('actual_price')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('actual_price')}>سعر البيع{getSortIndicator('actual_price')}</th>}
                  <th onClick={() => requestSort('fixed_bonus')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('fixed_bonus')}>ثابت{getSortIndicator('fixed_bonus')}</th>
                  {role === 'seller' && <th onClick={() => requestSort('extra_bonus')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('extra_bonus')}>إضافي{getSortIndicator('extra_bonus')}</th>}
                  <th onClick={() => requestSort('total_bonus')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('total_bonus')}>المجموع{getSortIndicator('total_bonus')}</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((b) => (
                  <tr key={b.id}>
                    <td>{b.date}</td>
                    <td>{b.item}</td>
                    <td className="number-cell">{b.quantity}</td>
                    {role === 'seller' && <td className="number-cell">{formatNumber(b.recommended_price)}</td>}
                    {role === 'seller' && <td className="number-cell">{formatNumber(b.actual_price)}</td>}
                    <td className="number-cell">{formatNumber(b.fixed_bonus)}</td>
                    {role === 'seller' && <td className="number-cell" style={{ color: b.extra_bonus > 0 ? '#1e40af' : '#94a3b8' }}>{formatNumber(b.extra_bonus)}</td>}
                    <td className="number-cell" style={{ fontWeight: 700, color: '#16a34a' }}>{formatNumber(b.total_bonus)}</td>
                    <td>
                      <StatusBadge status={b.settled ? 'تم الصرف' : 'مستحق'} />
                    </td>
                  </tr>
                ))}
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
        )}
      </div>
    </AppLayout>
  );
}

export default function MyBonusPage() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <MyBonusContent />
      </Suspense>
    </ToastProvider>
  );
}
