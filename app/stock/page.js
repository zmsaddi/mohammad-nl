'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import DataView from '@/components/DataView';
import PageSkeleton from '@/components/PageSkeleton';
import ErrorState from '@/components/ErrorState';
import FilterSheet from '@/components/FilterSheet';
import Pagination, { usePagination } from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { formatNumber, PRODUCT_CATEGORIES, numberInputProps } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import SortControl from '@/components/SortControl';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { useUrlFilters } from '@/lib/use-url-filters';
import { matchesText } from '@/lib/filter-engine';

const STOCK_FILTERS = { q: { default: '', debounce: 300 }, status: { default: 'all' }, category: { default: 'all' } };

function StockContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;
  const isAdmin = role === 'admin';
  // DONE: Bug 4 — only admin/manager may see cost data
  const canSeeCosts = ['admin', 'manager'].includes(role);
  // v1.2 — seller-scoped view. A seller uses this page to answer one
  // question: "can I promise this item to the customer right now?" They
  // don't need total-stock counts, inventory value, low-stock alerts
  // (management's concern), the ID column, the per-product threshold
  // field, or any edit/delete controls. Everything below branches on
  // this flag so the page becomes a focused "what's available to sell"
  // list when a seller lands on it.
  const isSeller = role === 'seller';

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  // Filters (q / status / category) URL-synced via the shared hook.
  const { values: f, set: setF, reset: resetFilters, isActive: filtersActive } = useUrlFilters(STOCK_FILTERS);

  // UX-02: pending sell_price change for confirmation
  const [pendingPrice, setPendingPrice] = useState(null);

  // DONE: Step 2 — product-specific stock status (uses per-product threshold, default 3)
  // ARC-06: parseFloat for NUMERIC-as-string. `!p.stock` would be false for
  // "0.00" because non-empty strings are truthy, so we compare numerically.
  const getStatus = (p) => {
    const threshold = p.low_stock_threshold ?? 3;
    const stockNum = parseFloat(p.stock) || 0;
    if (stockNum <= 0) return 'out';
    if (stockNum <= threshold) return 'low';
    return 'ok';
  };

  const getStatusLabel = (p) => {
    const s = getStatus(p);
    return s === 'out' ? 'نفذ' : s === 'low' ? 'منخفض' : 'متوفر';
  };

  const fetchData = async () => {
    try {
      setError(false);
      const res = await fetch('/api/products', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
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

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/products?id=${deleteId}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) {
        addToast('تم حذف المنتج');
        fetchData();
      }
    } catch {
      addToast('خطأ في الحذف', 'error');
    }
    setDeleteId(null);
  };

  // UX-02: confirm sell_price change
  const handleConfirmPrice = async () => {
    if (!pendingPrice) return;
    const { id, newPrice, oldPrice, inputRef } = pendingPrice;
    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, sell_price: newPrice }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addToast(body.error || 'خطأ في تحديث سعر البيع', 'error');
        if (inputRef) inputRef.value = oldPrice || '';
        setPendingPrice(null);
        return;
      }
      addToast('تم تحديث سعر البيع');
      fetchData();
    } catch {
      addToast('خطأ في الاتصال', 'error');
    }
    setPendingPrice(null);
  };

  const handleCancelPrice = () => {
    if (pendingPrice?.inputRef) {
      pendingPrice.inputRef.value = pendingPrice.oldPrice || '';
    }
    setPendingPrice(null);
  };

  // Status filter ('in-stock'→ok / 'low' / 'out') uses the per-product threshold
  // via getStatus — a derived predicate kept inline (the shared engine handles
  // search + the simple category equality).
  const filtered = useMemo(() => products.filter((p) => {
    if (!matchesText([p.name, p.category, p.description_ar], f.q)) return false;
    if (f.status === 'in-stock' && getStatus(p) !== 'ok') return false;
    if (f.status === 'low' && getStatus(p) !== 'low') return false;
    if (f.status === 'out' && getStatus(p) !== 'out') return false;
    if (f.category !== 'all' && p.category !== f.category) return false;
    return true;
  }), [products, f.q, f.status, f.category]);

  // Item 3 — click-to-sort on column headers, default name ascending
  const { sortedRows, requestSort, setSort, sortConfig, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'name', direction: 'asc' }
  );

  // PA-03: pagination
  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows, resetPage } = usePagination(sortedRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { resetPage(); }, [f.q, f.status, f.category]);

  const totalProducts = products.length;
  // ARC-06: parseFloat on every NUMERIC read so reducers don't string-concat.
  const totalStock = products.reduce((s, p) => s + (parseFloat(p.stock) || 0), 0);
  // DONE: Bug 4 — sellers receive products with buy_price stripped server-side, so total = 0 for them
  const totalValue = canSeeCosts
    ? products.reduce((s, p) => s + ((parseFloat(p.stock) || 0) * (parseFloat(p.buy_price) || 0)), 0)
    : 0;
  // DONE: Step 2 — out/low counts also use the per-product threshold
  const outOfStock = products.filter((p) => getStatus(p) === 'out').length;
  const lowStock = products.filter((p) => getStatus(p) === 'low').length;

  return (
    <AppLayout>
      <div className="page-header">
        <h2>المخزون</h2>
        <p>{isSeller ? 'المنتجات المتاحة للبيع وأسعارها' : 'جرد المنتجات والكميات المتاحة'}</p>
      </div>

      {/* Stats — v1.2 sellers see a focused "what can I sell?" view */}
      <div className="summary-cards" style={{ marginBottom: '24px' }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>عدد المنتجات</h3>
            <div className="value">{totalProducts}</div>
          </div>
        </div>
        {/* Hide total-pieces count for sellers — it's a warehouse metric,
            not a selling metric. Replace with an "available to sell" count. */}
        {isSeller ? (
          <div className="summary-card">
            <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div className="summary-card-content">
              <h3>متاح للبيع</h3>
              <div className="value" style={{ color: '#16a34a' }}>
                {products.filter((p) => (parseFloat(p.stock) || 0) > 0).length}
              </div>
            </div>
          </div>
        ) : (
          <div className="summary-card">
            <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75l-5.571-3m11.142 0l4.179 2.25L12 17.25l-9.75-5.25 4.179-2.25m11.142 0l4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25" /></svg>
            </div>
            <div className="summary-card-content">
              <h3>إجمالي القطع</h3>
              <div className="value" style={{ color: '#16a34a' }}>{formatNumber(totalStock)}</div>
            </div>
          </div>
        )}
        {/* DONE: Bug 4 — hide entire inventory-value card from sellers */}
        {canSeeCosts && (
          <div className="summary-card">
            <div className="summary-card-icon" style={{ background: '#e0e7ff' }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#4f46e5" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div className="summary-card-content">
              <h3>قيمة المخزون</h3>
              <div className="value" style={{ color: '#4f46e5' }}>{formatNumber(totalValue)}</div>
            </div>
          </div>
        )}
        {/* Alerts card: hidden for sellers (restocking is management's concern).
            The per-row "نفذ" badge still shows sellers which products are
            unavailable — they don't need a separate aggregate card. */}
        {!isSeller && (
          <div className="summary-card">
            <div className="summary-card-icon" style={{ background: lowStock > 0 || outOfStock > 0 ? '#fee2e2' : '#dcfce7' }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={outOfStock > 0 ? '#dc2626' : '#16a34a'} width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            </div>
            <div className="summary-card-content">
              <h3>تنبيهات</h3>
              <div style={{ fontSize: '0.85rem' }}>
                {totalProducts === 0 && <div style={{ color: '#94a3b8', fontWeight: 600 }}>لا توجد منتجات</div>}
                {totalProducts > 0 && outOfStock > 0 && <div style={{ color: '#dc2626', fontWeight: 600 }}>{outOfStock} نفذ</div>}
                {totalProducts > 0 && lowStock > 0 && <div style={{ color: '#f59e0b', fontWeight: 600 }}>{lowStock} مخزون منخفض</div>}
                {totalProducts > 0 && outOfStock === 0 && lowStock === 0 && <div style={{ color: '#16a34a', fontWeight: 600 }}>كل شيء متوفر</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Low/out stock alert banner — hidden for sellers (restocking alert,
          not a selling alert). Sellers still see out-of-stock rows marked
          with the red "نفذ" badge and row tint. */}
      {!isSeller && (lowStock > 0 || outOfStock > 0) && (
        <div style={{
          background: outOfStock > 0 ? '#fef2f2' : '#fffbeb',
          border: `1px solid ${outOfStock > 0 ? '#fca5a5' : '#fcd34d'}`,
          borderRadius: '12px',
          padding: '14px 20px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <span style={{ fontSize: '1.4rem' }}>{outOfStock > 0 ? '🔴' : '🟡'}</span>
          <div>
            <div style={{
              fontWeight: 700,
              color: outOfStock > 0 ? '#dc2626' : '#d97706',
              fontSize: '0.95rem',
            }}>
              {outOfStock > 0
                ? `${outOfStock} منتج نفذ من المخزون`
                : `${lowStock} منتج وصل للحد الأدنى`}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '2px' }}>
              {outOfStock > 0 && lowStock > 0
                ? `بالإضافة إلى ${lowStock} منتج بمخزون منخفض`
                : 'راجع المخزون وأضف كميات عند الحاجة'}
            </div>
          </div>
          <button
            onClick={() => setF('status', outOfStock > 0 ? 'out' : 'low')}
            style={{
              marginRight: 'auto',
              padding: '6px 14px',
              background: outOfStock > 0 ? '#dc2626' : '#d97706',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontFamily: "'Cairo', sans-serif",
              fontWeight: 600,
            }}
          >
            عرض المنتجات
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            جرد المخزون ({filtered.length === products.length ? products.length : `${filtered.length} من ${products.length}`})
          </h3>
          <FilterSheet
            isActive={filtersActive}
            onClear={resetFilters}
            chips={[
              f.q && { label: `بحث: ${f.q}`, onRemove: () => setF('q', '') },
              f.status !== 'all' && { label: ({ 'in-stock': 'متوفر', low: 'مخزون منخفض', out: 'نفذ' })[f.status] || f.status, onRemove: () => setF('status', 'all') },
              f.category !== 'all' && { label: f.category, onRemove: () => setF('category', 'all') },
            ].filter(Boolean)}
          >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              aria-label="بحث في المخزون"
              placeholder="بحث بالاسم أو الفئة..."
              value={f.q}
              onChange={(e) => setF('q', e.target.value)}
              className="filter-control-lg"
            />
            <select
              value={f.status}
              onChange={(e) => setF('status', e.target.value)}
              aria-label="تصفية حسب حالة المخزون"
              className="filter-control-lg"
            >
              <option value="all">الكل</option>
              <option value="in-stock">متوفر</option>
              <option value="low">مخزون منخفض</option>
              <option value="out">نفذ</option>
            </select>
            {/* DONE: Step 2 — category filter dropdown */}
            <select
              value={f.category}
              onChange={(e) => setF('category', e.target.value)}
              aria-label="تصفية حسب الفئة"
              className="filter-control-lg"
            >
              <option value="all">كل الفئات</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {filtersActive && (
              <button className="btn btn-sm btn-clear" onClick={resetFilters} style={{ whiteSpace: 'nowrap' }}>✕ مسح</button>
            )}
          </div>
          </FilterSheet>
        </div>

        <SortControl
          fields={[
            { key: 'name', label: 'الاسم' },
            { key: 'stock', label: 'المخزون' },
            { key: 'category', label: 'الفئة' },
          ]}
          sortConfig={sortConfig}
          setSort={setSort}
        />

        {loading ? (
          <PageSkeleton rows={6} showStats={false} />
        ) : error ? (
          <ErrorState onRetry={fetchData} />
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>{filtersActive ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات بعد'}</h3>
            <p>{filtersActive ? 'جرّب تعديل الفلاتر أو مسحها' : 'المنتجات تُضاف تلقائياً عند الشراء'}</p>
            {filtersActive && (
              <button className="btn btn-sm btn-clear" style={{ marginTop: 8 }} onClick={resetFilters}>✕ مسح الفلاتر</button>
            )}
          </div>
        ) : (
          <>
            {/* Unified mobile-first DataView. The desktop table keeps the
                inline-editable inputs (admin); mobile cards show read-only
                values via mobileCell / mobileHide for parity with the old
                card list. Per-product totals live in the summary cards above,
                so the old table footer is intentionally dropped. */}
            <DataView
              rows={paginatedRows}
              sort={{ requestSort, getAriaSort, getSortIndicator }}
              onRowClick={(row) => setSelectedRow(row)}
              rowKey={(row) => row.id}
              emptyMessage="لا توجد منتجات"
              columns={[
                // v1.2 — internal DB id: admin/manager audit column, hidden from
                // sellers and always hidden on mobile cards.
                !isSeller && { key: 'id', label: '#', sortable: true, mobileHide: true },
                { key: 'name', label: 'المنتج (لاتيني)', sortable: true, cell: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
                {
                  key: 'description_ar', label: 'الوصف (عربي)', sortable: true, mobileHide: true, fullWidth: true,
                  cell: (p) => isAdmin ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        defaultValue={p.description_ar || ''}
                        placeholder="الوصف بالعربي"
                        style={{ width: '100%', maxWidth: '320px', boxSizing: 'border-box', padding: '4px 6px', border: '1.5px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', fontFamily: "'Cairo', sans-serif" }}
                        onBlur={async (e) => {
                          const val = e.target.value.trim();
                          if (val !== (p.description_ar || '')) {
                            try {
                              await fetch('/api/products', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, description_ar: val }), cache: 'no-store' });
                              addToast('تم تحديث الوصف العربي');
                              fetchData();
                            } catch { addToast('خطأ في التحديث', 'error'); }
                          }
                        }}
                      />
                    </div>
                  ) : <span style={{ color: '#64748b' }}>{p.description_ar || '—'}</span>,
                },
                { key: 'category', label: 'الفئة', sortable: true, cell: (p) => p.category || '-' },
                canSeeCosts && { key: 'buy_price', label: 'سعر الشراء', align: 'end', sortable: true, cell: (p) => formatNumber(p.buy_price) },
                {
                  key: 'sell_price', label: 'سعر البيع', align: 'end', sortable: true,
                  // Mobile: read-only price (matches the old card list).
                  mobileCell: (p) => <span style={{ color: '#1e40af' }}>{p.sell_price ? formatNumber(p.sell_price) : '-'}</span>,
                  cell: (p) => isAdmin ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        {...numberInputProps}
                        min="0"
                        step="any"
                        defaultValue={p.sell_price || ''}
                        placeholder="0"
                        style={{ width: '80px', padding: '4px 6px', border: '1.5px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', textAlign: 'center', fontFamily: "'Cairo', sans-serif" }}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const currentSell = parseFloat(p.sell_price) || 0;
                          if (val !== currentSell) {
                            setPendingPrice({ id: p.id, name: p.name, oldPrice: currentSell, newPrice: val, inputRef: e.target });
                          }
                        }}
                      />
                    </div>
                  ) : <span style={{ color: '#1e40af' }}>{p.sell_price ? formatNumber(p.sell_price) : '-'}</span>,
                },
                // DONE: Step 2G — inline editable low-stock threshold (admin only)
                isAdmin && {
                  key: 'low_stock_threshold', label: 'حد التنبيه', align: 'end', sortable: true, mobileHide: true,
                  cell: (p) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        {...numberInputProps}
                        min="0"
                        defaultValue={p.low_stock_threshold ?? 3}
                        style={{ width: '60px', padding: '4px 6px', border: '1.5px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', textAlign: 'center', fontFamily: "'Cairo', sans-serif" }}
                        onBlur={async (e) => {
                          const val = parseInt(e.target.value, 10);
                          const safe = Number.isFinite(val) && val >= 0 ? val : 3;
                          if (safe !== (p.low_stock_threshold ?? 3)) {
                            try {
                              await fetch('/api/products', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, low_stock_threshold: safe }), cache: 'no-store' });
                              addToast('تم تحديث حد التنبيه');
                              fetchData();
                            } catch { addToast('خطأ في التحديث', 'error'); }
                          }
                        }}
                      />
                    </div>
                  ),
                },
                {
                  key: 'stock', label: 'الكمية', align: 'end', sortable: true,
                  cell: (p) => { const s = getStatus(p); return <span style={{ fontWeight: 700, color: s === 'out' ? '#dc2626' : s === 'low' ? '#d97706' : '#16a34a' }}>{formatNumber(p.stock)}</span>; },
                },
                // v1.2 — parseFloat both operands (NUMERIC arrives as string).
                canSeeCosts && {
                  key: 'value', label: 'قيمة المخزون', align: 'end', mobileHide: true,
                  cell: (p) => <span style={{ fontWeight: 600 }}>{formatNumber((parseFloat(p.stock) || 0) * (parseFloat(p.buy_price) || 0))}</span>,
                },
                { key: 'status', label: 'الحالة', cell: (p) => <StatusBadge status={getStatusLabel(p)} /> },
              ].filter(Boolean)}
              actions={isAdmin ? (row) => (
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>حذف</button>
              ) : undefined}
            />

            {/* PA-03: Pagination */}
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

      <DetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `منتج: ${selectedRow.name}` : ''}
        fields={selectedRow ? [
          { label: 'اسم المنتج', value: selectedRow.name },
          { label: 'الفئة', value: selectedRow.category || '-' },
          { label: 'الوحدة', value: selectedRow.unit || '-' },
          { type: 'divider' },
          // DONE: Bug 4 — strip cost-related fields from the detail modal for sellers
          ...(canSeeCosts ? [{ label: 'سعر الشراء', type: 'money', value: selectedRow.buy_price }] : []),
          { label: 'سعر البيع الموصى', type: 'money', value: selectedRow.sell_price, color: '#1e40af' },
          { type: 'divider' },
          { label: 'الكمية المتاحة', value: String(parseFloat(selectedRow.stock) || 0), color: (parseFloat(selectedRow.stock) || 0) > 5 ? '#16a34a' : (parseFloat(selectedRow.stock) || 0) > 0 ? '#d97706' : '#dc2626' },
          // v1.2 — parseFloat for NUMERIC-as-string from @vercel/postgres.
          ...(canSeeCosts ? [{ label: 'قيمة المخزون', type: 'money', value: (parseFloat(selectedRow.stock) || 0) * (parseFloat(selectedRow.buy_price) || 0) }] : []),
          ...(selectedRow.created_by ? [{ label: 'بواسطة', value: selectedRow.created_by }] : []),
        ] : []}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف منتج"
        message="هل أنت متأكد؟ سيتم حذف المنتج من المخزون."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* UX-02: Sell price change confirmation modal */}
      <ConfirmModal
        isOpen={!!pendingPrice}
        title="تأكيد تغيير سعر البيع"
        confirmText="نعم، حفظ"
        confirmClass="btn-primary"
        onConfirm={handleConfirmPrice}
        onCancel={handleCancelPrice}
      >
        <p>
          هل تريد تغيير سعر البيع من{' '}
          <strong>{formatNumber(pendingPrice?.oldPrice || 0)}</strong>{' '}
          إلى{' '}
          <strong>{formatNumber(pendingPrice?.newPrice || 0)}</strong>؟
        </p>
        {pendingPrice?.name && (
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '4px' }}>
            المنتج: {pendingPrice.name}
          </p>
        )}
      </ConfirmModal>
    </AppLayout>
  );
}

export default function StockPage() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <StockContent />
      </Suspense>
    </ToastProvider>
  );
}
