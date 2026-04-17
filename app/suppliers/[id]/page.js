'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import PageSkeleton from '@/components/PageSkeleton';
import StatusBadge from '@/components/StatusBadge';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import DataCardList from '@/components/DataCardList';

function SupplierDetailContent() {
  const { id } = useParams();
  const addToast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payForm, setPayForm] = useState({ purchaseId: '', amount: '', paymentMethod: 'كاش' });
  const [paying, setPaying] = useState(false);

  const fetchData = async () => {
    try {
      const suppliersRes = await fetch('/api/suppliers?withDebt=true', { cache: 'no-store' });
      const suppliersData = await suppliersRes.json();
      const found = (Array.isArray(suppliersData) ? suppliersData : []).find((s) => s.id === Number(id));
      if (!found) { setLoading(false); return; }
      setSupplier(found);

      const purchasesRes = await fetch(`/api/purchases?supplier=${encodeURIComponent(found.name)}`, { cache: 'no-store' });
      const purchasesData = await purchasesRes.json();
      setPurchases(Array.isArray(purchasesData) ? purchasesData : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [id]);
  useAutoRefresh(fetchData);

  const handlePay = async (e) => {
    e.preventDefault();
    if (!payForm.purchaseId || !payForm.amount) { addToast('اختر عملية الشراء وأدخل المبلغ', 'error'); return; }
    setPaying(true);
    try {
      const res = await fetch(`/api/purchases/${payForm.purchaseId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: payForm.amount, paymentMethod: payForm.paymentMethod }),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم تسجيل الدفعة بنجاح');
        setPayForm({ purchaseId: '', amount: '', paymentMethod: 'كاش' });
        fetchData();
      } else {
        const d = await res.json().catch(() => ({}));
        addToast(d.error || 'خطأ في تسجيل الدفعة', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setPaying(false);
    }
  };

  const purchasesSort = useSortedRows(purchases, { key: 'date', direction: 'desc' });
  const unpaidPurchases = purchases.filter((p) => p.payment_status !== 'paid');
  const totalDebt = unpaidPurchases.reduce((s, p) => s + Math.max(0, (parseFloat(p.total) || 0) - (parseFloat(p.paid_amount) || 0)), 0);

  if (loading) return <AppLayout><PageSkeleton rows={6} /></AppLayout>;
  if (!supplier) return <AppLayout><div className="card" style={{ padding: 40, textAlign: 'center' }}><h3>المورد غير موجود</h3><Link href="/suppliers" className="btn btn-primary" style={{ marginTop: 16 }}>العودة للموردين</Link></div></AppLayout>;

  return (
    <AppLayout>
      <div style={{ marginBottom: 16 }}>
        <Link href="/suppliers" style={{ color: 'var(--color-info)', fontSize: '0.85rem', textDecoration: 'none' }}>← العودة للموردين</Link>
      </div>

      {/* Supplier Info Card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 8 }}>{supplier.name}</h2>
            {supplier.phone && <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', direction: 'ltr', textAlign: 'right' }}>{supplier.phone}</div>}
            {supplier.address && <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{supplier.address}</div>}
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>إجمالي المشتريات</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{formatNumber(supplier.totalPurchases)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>المدفوع</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-success)' }}>{formatNumber(supplier.totalPaid)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>الدين المتبقي</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: totalDebt > 0 ? '#dc2626' : 'var(--color-success)' }}>{formatNumber(totalDebt)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pay Supplier Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12, color: 'var(--color-text-secondary)' }}>تسوية ديون المورد</h3>
        {unpaidPurchases.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--color-success)', fontSize: '0.9rem', fontWeight: 600 }}>
            ✓ لا يوجد ديون مستحقة — جميع المشتريات مدفوعة بالكامل
          </div>
        ) : (
          <>
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: '0.85rem', color: '#dc2626', fontWeight: 600 }}>
            ⚠ يوجد {unpaidPurchases.length} عملية غير مدفوعة بالكامل — إجمالي الدين: {formatNumber(totalDebt)}
          </div>
          <form onSubmit={handlePay}>
            <div className="form-grid">
              <div className="form-group">
                <label>اختر عملية الشراء *</label>
                <select value={payForm.purchaseId} onChange={(e) => {
                  const p = unpaidPurchases.find((x) => String(x.id) === e.target.value);
                  setPayForm({ ...payForm, purchaseId: e.target.value, amount: p ? String(Math.max(0, (parseFloat(p.total) || 0) - (parseFloat(p.paid_amount) || 0)).toFixed(2)) : '' });
                }} required>
                  <option value="">-- اختر --</option>
                  {unpaidPurchases.map((p) => {
                    const remaining = Math.max(0, (parseFloat(p.total) || 0) - (parseFloat(p.paid_amount) || 0));
                    return <option key={p.id} value={p.id}>{p.item} — {p.date} — متبقي: {formatNumber(remaining)}</option>;
                  })}
                </select>
              </div>
              <div className="form-group">
                <label>المبلغ *</label>
                <input type="number" min="0" step="any" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>طريقة الدفع</label>
                <div className="radio-group" style={{ marginTop: 6 }}>
                  <label className="radio-option"><input type="radio" name="supPayMethod" value="كاش" checked={payForm.paymentMethod === 'كاش'} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} /> كاش</label>
                  <label className="radio-option"><input type="radio" name="supPayMethod" value="بنك" checked={payForm.paymentMethod === 'بنك'} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} /> بنك</label>
                </div>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={paying}>{paying ? 'جاري الدفع...' : 'تسجيل الدفعة'}</button>
          </form>
          </>
        )}
      </div>

      {/* Purchases History */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16, color: 'var(--color-text-secondary)' }}>سجل المشتريات ({purchases.length})</h3>
        {purchases.length === 0 ? (
          <div className="empty-state"><h3>لا توجد مشتريات من هذا المورد</h3></div>
        ) : (
          <>
          <DataCardList
            rows={purchasesSort.sortedRows}
            fields={[
              { key: 'date', label: 'التاريخ' },
              { key: 'item', label: 'المنتج' },
              { key: 'quantity', label: 'الكمية', format: (v) => formatNumber(v) },
              { key: 'unit_price', label: 'سعر الوحدة', format: (v) => formatNumber(v) },
              { key: 'total', label: 'الإجمالي', format: (v) => formatNumber(v) },
              { key: 'paid_amount', label: 'المدفوع', format: (v) => formatNumber(v) },
              { key: 'remaining', label: 'المتبقي', format: (_v, row) => {
                const remaining = Math.max(0, (parseFloat(row.total) || 0) - (parseFloat(row.paid_amount) || 0));
                return formatNumber(remaining);
              } },
              { key: 'payment_status', label: 'الحالة', format: (v) => v === 'paid' ? 'مدفوع' : v === 'partial' ? 'جزئي' : 'معلق' },
            ]}
            emptyMessage="لا توجد مشتريات"
          />
          <div className="table-container has-card-fallback">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => purchasesSort.requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={purchasesSort.getAriaSort('date')}>التاريخ{purchasesSort.getSortIndicator('date')}</th>
                  <th onClick={() => purchasesSort.requestSort('item')} style={{ cursor: 'pointer' }} aria-sort={purchasesSort.getAriaSort('item')}>المنتج{purchasesSort.getSortIndicator('item')}</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th onClick={() => purchasesSort.requestSort('total')} style={{ cursor: 'pointer' }} aria-sort={purchasesSort.getAriaSort('total')}>الإجمالي{purchasesSort.getSortIndicator('total')}</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {purchasesSort.sortedRows.map((p) => {
                  const remaining = Math.max(0, (parseFloat(p.total) || 0) - (parseFloat(p.paid_amount) || 0));
                  const statusLabel = p.payment_status === 'paid' ? 'مدفوع' : p.payment_status === 'partial' ? 'جزئي' : 'معلق';
                  return (
                    <tr key={p.id}>
                      <td>{p.date}</td>
                      <td style={{ fontWeight: 600 }}>{p.item}</td>
                      <td className="number-cell">{formatNumber(p.quantity)}</td>
                      <td className="number-cell">{formatNumber(p.unit_price)}</td>
                      <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(p.total)}</td>
                      <td className="number-cell" style={{ color: 'var(--color-success)' }}>{formatNumber(p.paid_amount)}</td>
                      <td className="number-cell" style={{ color: remaining > 0 ? '#dc2626' : 'var(--color-success)', fontWeight: 600 }}>{formatNumber(remaining)}</td>
                      <td><StatusBadge status={statusLabel} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

export default function SupplierDetailPage() {
  return <ToastProvider><SupplierDetailContent /></ToastProvider>;
}
