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
import { formatNumber, PRODUCT_CATEGORIES } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

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
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, in-stock, low, out
  // DONE: Step 2 — category filter
  const [categoryFilter, setCategoryFilter] = useState('all');

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
      const res = await fetch('/api/products', { cache: 'no-store' });
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {
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

  let filtered = products.filter((p) =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.category?.toLowerCase().includes(search.toLowerCase())
  );

  // DONE: Step 2 — status filter now uses product-specific threshold via getStatus()
  if (filter === 'in-stock') filtered = filtered.filter((p) => getStatus(p) === 'ok');
  else if (filter === 'low') filtered = filtered.filter((p) => getStatus(p) === 'low');
  else if (filter === 'out') filtered = filtered.filter((p) => getStatus(p) === 'out');

  // DONE: Step 2 — category filter
  if (categoryFilter !== 'all') {
    filtered = filtered.filter((p) => p.category === categoryFilter);
  }

  // Item 3 — click-to-sort on column headers, default name ascending
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    filtered,
    { key: 'name', direction: 'asc' }
  );

  // PA-03: pagination
  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows } = usePagination(sortedRows);

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

  // PA-02: DataCardList field definitions
  const cardFields = [
    { key: 'name', label: 'المنتج' },
    { key: 'category', label: 'الفئة' },
    ...(canSeeCosts ? [{ key: 'buy_price', label: 'سعر الشراء', format: (v) => formatNumber(v) }] : []),
    { key: 'sell_price', label: 'سعر البيع', format: (v) => v ? formatNumber(v) : '-' },
    { key: 'stock', label: 'الكمية', format: (v) => formatNumber(v) },
  ];

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
            onClick={() => setFilter(outOfStock > 0 ? 'out' : 'low')}
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
            جرد المخزون ({filtered.length})
          </h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="بحث بالاسم أو الفئة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            >
              <option value="all">الكل</option>
              <option value="in-stock">متوفر</option>
              <option value="low">مخزون منخفض</option>
              <option value="out">نفذ</option>
            </select>
            {/* DONE: Step 2 — category filter dropdown */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            >
              <option value="all">كل الفئات</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <PageSkeleton rows={6} showStats={false} />
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>{search || filter !== 'all' ? 'لا توجد نتائج' : 'لا توجد منتجات بعد'}</h3>
            <p>المنتجات تُضاف تلقائياً عند الشراء</p>
          </div>
        ) : (
          <>
            {/* PA-02: Mobile card fallback */}
            <DataCardList
              rows={paginatedRows.map((p) => ({ ...p, statusLabel: getStatusLabel(p) }))}
              fields={cardFields}
              statusField="statusLabel"
              statusColors={{ 'متوفر': '#16a34a', 'منخفض': '#d97706', 'نفذ': '#dc2626' }}
              actions={(row) => (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => setSelectedRow(row)}>تفاصيل</button>
                  {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>حذف</button>}
                </>
              )}
            />

            <div className="table-container has-card-fallback">
              <table className="data-table">
                <thead>
                  <tr>
                    {/* v1.2 — hide the internal "#" (DB id) column from sellers.
                        Useful for admin audit, noise for sellers scanning for
                        what to quote a customer. */}
                    {!isSeller && <th onClick={() => requestSort('id')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('id')}>#{getSortIndicator('id')}</th>}
                    <th onClick={() => requestSort('name')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('name')}>المنتج (لاتيني){getSortIndicator('name')}</th>
                    <th onClick={() => requestSort('description_ar')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('description_ar')}>الوصف (عربي){getSortIndicator('description_ar')}</th>
                    <th onClick={() => requestSort('category')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('category')}>الفئة{getSortIndicator('category')}</th>
                    {canSeeCosts && <th onClick={() => requestSort('buy_price')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('buy_price')}>سعر الشراء{getSortIndicator('buy_price')}</th>}
                    <th onClick={() => requestSort('sell_price')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('sell_price')}>سعر البيع{getSortIndicator('sell_price')}</th>
                    {isAdmin && <th onClick={() => requestSort('low_stock_threshold')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('low_stock_threshold')}>حد التنبيه{getSortIndicator('low_stock_threshold')}</th>}
                    <th onClick={() => requestSort('stock')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('stock')}>الكمية{getSortIndicator('stock')}</th>
                    {canSeeCosts && <th>قيمة المخزون</th>}
                    <th>الحالة</th>
                    {isAdmin && <th>إجراءات</th>}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((p) => {
                    // v1.2 — parseFloat both operands. @vercel/postgres returns
                    // NUMERIC columns as strings; `"5.00" * "12.50"` silently
                    // coerces through JS's loose multiplication but any sibling
                    // `|| 0` fallback made the whole expression NaN when stock
                    // or buy_price was missing.
                    const value = (parseFloat(p.stock) || 0) * (parseFloat(p.buy_price) || 0);
                    // DONE: Step 2F — replace hardcoded ≤5 threshold with per-product getStatus()
                    const status = getStatus(p);
                    const statusLabel = status === 'out' ? 'نفذ' : status === 'low' ? 'منخفض' : 'متوفر';
                    return (
                      <tr key={p.id} className="clickable-row" onClick={() => setSelectedRow(p)} style={{ background: status === 'out' ? '#fef2f2' : status === 'low' ? '#fffbeb' : '' }}>
                        {!isSeller && <td>{p.id}</td>}
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {isAdmin ? (
                            <input
                              type="text"
                              defaultValue={p.description_ar || ''}
                              placeholder="الوصف بالعربي"
                              style={{ width: '120px', padding: '4px 6px', border: '1.5px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', fontFamily: "'Cairo', sans-serif" }}
                              onBlur={async (e) => {
                                const val = e.target.value.trim();
                                if (val !== (p.description_ar || '')) {
                                  try {
                                    await fetch('/api/products', {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: p.id, description_ar: val }),
                                      cache: 'no-store',
                                    });
                                    addToast('تم تحديث الوصف العربي');
                                    fetchData();
                                  } catch { addToast('خطأ في التحديث', 'error'); }
                                }
                              }}
                            />
                          ) : (
                            <span style={{ color: '#64748b' }}>{p.description_ar || '—'}</span>
                          )}
                        </td>
                        <td>{p.category || '-'}</td>
                        {canSeeCosts && <td className="number-cell">{formatNumber(p.buy_price)}</td>}
                        <td className="number-cell">
                          {isAdmin ? (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={p.sell_price || ''}
                              placeholder="0"
                              style={{ width: '80px', padding: '4px 6px', border: '1.5px solid #d1d5db', borderRadius: '6px', fontSize: '0.8rem', textAlign: 'center', fontFamily: "'Cairo', sans-serif" }}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const currentSell = parseFloat(p.sell_price) || 0;
                                if (val !== currentSell) {
                                  setPendingPrice({
                                    id: p.id,
                                    name: p.name,
                                    oldPrice: currentSell,
                                    newPrice: val,
                                    inputRef: e.target,
                                  });
                                }
                              }}
                            />
                          ) : (
                            <span style={{ color: '#1e40af' }}>{p.sell_price ? formatNumber(p.sell_price) : '-'}</span>
                          )}
                        </td>
                        {/* DONE: Step 2G — inline editable low-stock threshold (admin only) */}
                        {isAdmin && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              min="0"
                              defaultValue={p.low_stock_threshold ?? 3}
                              style={{
                                width: '60px', padding: '4px 6px',
                                border: '1.5px solid #d1d5db', borderRadius: '6px',
                                fontSize: '0.8rem', textAlign: 'center',
                                fontFamily: "'Cairo', sans-serif",
                              }}
                              onBlur={async (e) => {
                                const val = parseInt(e.target.value, 10);
                                const safe = Number.isFinite(val) && val >= 0 ? val : 3;
                                if (safe !== (p.low_stock_threshold ?? 3)) {
                                  try {
                                    await fetch('/api/products', {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: p.id, low_stock_threshold: safe }),
                                      cache: 'no-store',
                                    });
                                    addToast('تم تحديث حد التنبيه');
                                    fetchData();
                                  } catch { addToast('خطأ في التحديث', 'error'); }
                                }
                              }}
                            />
                          </td>
                        )}
                        <td className="number-cell" style={{ fontWeight: 700, color: status === 'out' ? '#dc2626' : status === 'low' ? '#d97706' : '#16a34a' }}>
                          {formatNumber(p.stock)}
                        </td>
                        {canSeeCosts && <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(value)}</td>}
                        <td>
                          <StatusBadge status={statusLabel} />
                        </td>
                        {isAdmin && (
                          <td>
                            <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(p.id)}>حذف</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {/* v1.2 — colspan recomputed across three axes:
                        - id column: seller hidden (-1)
                        - buy_price + value columns: canSeeCosts (+0 or +2)
                        - threshold column: admin only (+1)
                      Base columns up to "الكمية" = id + name + desc + category
                      + sell_price = 5 (or 4 when id is hidden for seller). */}
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td colSpan={(isSeller ? 3 : 4) + (canSeeCosts ? 1 : 0) + (isAdmin ? 1 : 0)} style={{ textAlign: 'center' }}>الإجمالي</td>
                    <td className="number-cell">{formatNumber(totalStock)}</td>
                    {canSeeCosts && <td className="number-cell" style={{ color: '#4f46e5' }}>{formatNumber(totalValue)}</td>}
                    <td colSpan={isAdmin ? 2 : 1}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

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
      <StockContent />
    </ToastProvider>
  );
}
