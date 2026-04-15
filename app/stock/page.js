'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import { formatNumber, PRODUCT_CATEGORIES } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';

function StockContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';
  // DONE: Bug 4 — only admin/manager may see cost data
  const canSeeCosts = ['admin', 'manager'].includes(session?.user?.role);

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, in-stock, low, out
  // DONE: Step 2 — category filter
  const [categoryFilter, setCategoryFilter] = useState('all');

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
  const { sortedRows, requestSort, getSortIndicator } = useSortedRows(
    filtered,
    { key: 'name', direction: 'asc' }
  );

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
        <p>جرد المنتجات والكميات المتاحة</p>
      </div>

      {/* Stats */}
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
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75l-5.571-3m11.142 0l4.179 2.25L12 17.25l-9.75-5.25 4.179-2.25m11.142 0l4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>إجمالي القطع</h3>
            <div className="value" style={{ color: '#16a34a' }}>{formatNumber(totalStock)}</div>
          </div>
        </div>
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
      </div>

      {/* DONE: Step 5 — low/out stock alert banner. Click-through filters the table */}
      {(lowStock > 0 || outOfStock > 0) && (
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
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>{search || filter !== 'all' ? 'لا توجد نتائج' : 'لا توجد منتجات بعد'}</h3>
            <p>المنتجات تُضاف تلقائياً عند الشراء</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('id')} style={{ cursor: 'pointer' }}>#{getSortIndicator('id')}</th>
                  <th onClick={() => requestSort('name')} style={{ cursor: 'pointer' }}>المنتج{getSortIndicator('name')}</th>
                  <th onClick={() => requestSort('category')} style={{ cursor: 'pointer' }}>الفئة{getSortIndicator('category')}</th>
                  {canSeeCosts && <th onClick={() => requestSort('buy_price')} style={{ cursor: 'pointer' }}>سعر الشراء{getSortIndicator('buy_price')}</th>}
                  <th onClick={() => requestSort('sell_price')} style={{ cursor: 'pointer' }}>سعر البيع{getSortIndicator('sell_price')}</th>
                  {isAdmin && <th onClick={() => requestSort('low_stock_threshold')} style={{ cursor: 'pointer' }}>حد التنبيه{getSortIndicator('low_stock_threshold')}</th>}
                  <th onClick={() => requestSort('stock')} style={{ cursor: 'pointer' }}>الكمية{getSortIndicator('stock')}</th>
                  {canSeeCosts && <th>قيمة المخزون</th>}
                  <th>الحالة</th>
                  {isAdmin && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((p) => {
                  const value = (p.stock || 0) * (p.buy_price || 0);
                  // DONE: Step 2F — replace hardcoded ≤5 threshold with per-product getStatus()
                  const status = getStatus(p);
                  return (
                    <tr key={p.id} className="clickable-row" onClick={() => setSelectedRow(p)} style={{ background: status === 'out' ? '#fef2f2' : status === 'low' ? '#fffbeb' : '' }}>
                      <td>{p.id}</td>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
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
                            onBlur={async (e) => {
                              const val = parseFloat(e.target.value) || 0;
                              // ARC-06: p.sell_price is a string under NUMERIC, so
                              // `val !== p.sell_price` would always be true (strict
                              // equality across types). parseFloat for the compare.
                              const currentSell = parseFloat(p.sell_price) || 0;
                              if (val !== currentSell) {
                                // BUG-31: preserve server's Arabic error message.
                                // The old catch-all `catch { addToast('خطأ') }` swallowed
                                // the BUG-30 sell_price >= buy_price guard message
                                // ("سعر البيع الموصى ... لا يمكن أن يكون أقل من سعر الشراء")
                                // and showed a vague "خطأ" toast with zero context. Now
                                // the 400 response body is surfaced verbatim so the
                                // admin knows exactly why the update was rejected.
                                try {
                                  const res = await fetch('/api/products', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: p.id, sell_price: val }),
                                    cache: 'no-store',
                                  });
                                  if (!res.ok) {
                                    const body = await res.json().catch(() => ({}));
                                    addToast(body.error || 'خطأ في تحديث سعر البيع', 'error');
                                    // Reset the input to the current DB value so the UI
                                    // matches what the server has.
                                    e.target.value = currentSell || '';
                                    return;
                                  }
                                  addToast('تم تحديث سعر البيع');
                                  fetchData();
                                } catch {
                                  addToast('خطأ في الاتصال', 'error');
                                }
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
                        <span className="status-badge" style={{
                          background: status === 'out' ? '#fee2e2' : status === 'low' ? '#fef3c7' : '#dcfce7',
                          color: status === 'out' ? '#dc2626' : status === 'low' ? '#d97706' : '#16a34a',
                        }}>
                          {status === 'out' ? 'نفذ' : status === 'low' ? 'منخفض' : 'متوفر'}
                        </span>
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
                {/* DONE: Step 2 — colspan recomputed for the new "حد التنبيه" admin-only column */}
                <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                  <td colSpan={(canSeeCosts ? 4 : 3) + (isAdmin ? 1 : 0)} style={{ textAlign: 'center' }}>الإجمالي</td>
                  <td className="number-cell">{formatNumber(totalStock)}</td>
                  {canSeeCosts && <td className="number-cell" style={{ color: '#4f46e5' }}>{formatNumber(totalValue)}</td>}
                  <td colSpan={isAdmin ? 2 : 1}></td>
                </tr>
              </tfoot>
            </table>
          </div>
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
          { label: 'الكمية المتاحة', value: String(selectedRow.stock || 0), color: (selectedRow.stock || 0) > 5 ? '#16a34a' : (selectedRow.stock || 0) > 0 ? '#d97706' : '#dc2626' },
          ...(canSeeCosts ? [{ label: 'قيمة المخزون', type: 'money', value: (selectedRow.stock || 0) * (selectedRow.buy_price || 0) }] : []),
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
