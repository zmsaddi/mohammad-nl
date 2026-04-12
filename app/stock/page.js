'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import { formatNumber } from '@/lib/utils';

function StockContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, in-stock, low, out

  const fetchData = async () => {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/products?id=${deleteId}`, { method: 'DELETE' });
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

  if (filter === 'in-stock') filtered = filtered.filter((p) => p.stock > 5);
  else if (filter === 'low') filtered = filtered.filter((p) => p.stock > 0 && p.stock <= 5);
  else if (filter === 'out') filtered = filtered.filter((p) => !p.stock || p.stock <= 0);

  const totalProducts = products.length;
  const totalStock = products.reduce((s, p) => s + (p.stock || 0), 0);
  const totalValue = products.reduce((s, p) => s + ((p.stock || 0) * (p.buy_price || 0)), 0);
  const outOfStock = products.filter((p) => !p.stock || p.stock <= 0).length;
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= 5).length;

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
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#e0e7ff' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#4f46e5" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>قيمة المخزون</h3>
            <div className="value" style={{ color: '#4f46e5' }}>{formatNumber(totalValue)}</div>
          </div>
        </div>
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
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <h3>{search || filter !== 'all' ? 'لا توجد نتائج' : 'لا توجد منتجات بعد'}</h3>
            <p>المنتجات تُضاف تلقائياً عند الشراء</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>المنتج</th>
                  <th>الفئة</th>
                  <th>سعر الشراء</th>
                  <th>سعر البيع</th>
                  <th>الكمية</th>
                  <th>قيمة المخزون</th>
                  <th>الحالة</th>
                  {isAdmin && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const value = (p.stock || 0) * (p.buy_price || 0);
                  const status = !p.stock || p.stock <= 0 ? 'out' : p.stock <= 5 ? 'low' : 'ok';
                  return (
                    <tr key={p.id} className="clickable-row" onClick={() => setSelectedRow(p)} style={{ background: status === 'out' ? '#fef2f2' : status === 'low' ? '#fffbeb' : '' }}>
                      <td>{p.id}</td>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{p.category || '-'}</td>
                      <td className="number-cell">{formatNumber(p.buy_price)}</td>
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
                              if (val !== (p.sell_price || 0)) {
                                try {
                                  const { sql } = await import('@vercel/postgres');
                                  await fetch('/api/products', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: p.id, sell_price: val }),
                                  });
                                  addToast('تم تحديث سعر البيع');
                                  fetchData();
                                } catch { addToast('خطأ', 'error'); }
                              }
                            }}
                          />
                        ) : (
                          <span style={{ color: '#1e40af' }}>{p.sell_price ? formatNumber(p.sell_price) : '-'}</span>
                        )}
                      </td>
                      <td className="number-cell" style={{ fontWeight: 700, color: status === 'out' ? '#dc2626' : status === 'low' ? '#d97706' : '#16a34a' }}>
                        {formatNumber(p.stock)}
                      </td>
                      <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(value)}</td>
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
                <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                  <td colSpan={4} style={{ textAlign: 'center' }}>الإجمالي</td>
                  <td className="number-cell">{formatNumber(totalStock)}</td>
                  <td className="number-cell" style={{ color: '#4f46e5' }}>{formatNumber(totalValue)}</td>
                  <td colSpan={2}></td>
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
          { label: 'سعر الشراء', type: 'money', value: selectedRow.buy_price },
          { label: 'سعر البيع الموصى', type: 'money', value: selectedRow.sell_price, color: '#1e40af' },
          { type: 'divider' },
          { label: 'الكمية المتاحة', value: String(selectedRow.stock || 0), color: (selectedRow.stock || 0) > 5 ? '#16a34a' : (selectedRow.stock || 0) > 0 ? '#d97706' : '#dc2626' },
          { label: 'قيمة المخزون', type: 'money', value: (selectedRow.stock || 0) * (selectedRow.buy_price || 0) },
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
