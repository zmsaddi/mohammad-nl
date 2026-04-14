'use client';

import { useState, useEffect, use } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber, getTodayDate } from '@/lib/utils';

function ClientDetailContent({ params }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [client, setClient] = useState(null);
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // FEAT-04: collection form now captures amount + method + optional
  // sale picker. FIFO is the default — amount walks across all open
  // credit sales oldest-first via POST /api/clients/[id]/collect.
  // When the user picks a specific sale, the form POSTs to
  // /api/sales/[id]/collect instead.
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'كاش',
    saleId: '', // '' = FIFO
  });

  const fetchData = async () => {
    try {
      const clientsRes = await fetch('/api/clients?withDebt=true');
      const clientsData = await clientsRes.json();
      const found = clientsData.find((c) => c.id === id);

      if (found) {
        setClient(found);
        const [salesRes, paymentsRes] = await Promise.all([
          fetch(`/api/sales?client=${encodeURIComponent(found.name)}`),
          fetch(`/api/payments?client=${encodeURIComponent(found.name)}`),
        ]);
        const salesData = await salesRes.json();
        const paymentsData = await paymentsRes.json();
        setSales(Array.isArray(salesData) ? salesData.reverse() : []);
        setPayments(Array.isArray(paymentsData) ? paymentsData.reverse() : []);
      }
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [id]);

  const handlePayment = async (e) => {
    e.preventDefault();
    const amount = parseFloat(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      addToast('يرجى إدخال مبلغ صحيح', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // FEAT-04: route selection — sale picker or FIFO walker
      const endpoint = paymentForm.saleId
        ? `/api/sales/${paymentForm.saleId}/collect`
        : `/api/clients/${id}/collect`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          paymentMethod: paymentForm.paymentMethod,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.applied && Array.isArray(data.applied) && data.applied.length > 1) {
          addToast(`تم توزيع الدفعة على ${data.applied.length} طلبات`);
        } else {
          addToast('تم تسجيل الدفعة بنجاح');
        }
        setPaymentForm({ amount: '', paymentMethod: 'كاش', saleId: '' });
        fetchData();
      } else {
        addToast(data.error || 'خطأ في تسجيل الدفعة', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Open sales for the sale picker (FIFO alternative)
  const openSales = sales.filter((s) =>
    s.status === 'مؤكد' &&
    parseFloat(s.remaining) > 0.005 &&
    s.payment_status !== 'paid'
  );
  const tvaPreview = (parseFloat(paymentForm.amount) || 0) / 6;

  if (loading) {
    return (
      <AppLayout>
        <div className="loading-overlay"><div className="spinner"></div></div>
      </AppLayout>
    );
  }

  if (!client) {
    return (
      <AppLayout>
        <div className="empty-state">
          <h3>العميل غير موجود</h3>
          <Link href="/clients" className="btn btn-primary" style={{ marginTop: '16px' }}>العودة للعملاء</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <Link href="/clients" style={{ color: '#64748b', textDecoration: 'none' }}>العملاء</Link>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h2 style={{ margin: 0 }}>{client.name}</h2>
        </div>
      </div>

      {/* Client Info */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="client-info-card">
          <div className="client-info-item">
            <label>اسم العميل</label>
            <div className="value">{client.name}</div>
          </div>
          <div className="client-info-item">
            <label>رقم الهاتف</label>
            <div className="value" style={{ direction: 'ltr', textAlign: 'right' }}>{client.phone || '-'}</div>
          </div>
          <div className="client-info-item">
            <label>الإيميل</label>
            <div className="value" style={{ direction: 'ltr', textAlign: 'right' }}>{client.email || '-'}</div>
          </div>
          <div className="client-info-item">
            <label>العنوان</label>
            <div className="value">{client.address || '-'}</div>
          </div>
          <div className="client-info-item">
            <label>إجمالي المشتريات</label>
            <div className="value">{formatNumber(client.totalSales)}</div>
          </div>
          <div className="client-info-item">
            <label>المدفوع</label>
            <div className="value" style={{ color: '#16a34a' }}>{formatNumber(client.totalPaid)}</div>
          </div>
          <div className="client-info-item">
            <label>الدين المتبقي</label>
            <div className="value" style={{ color: client.remainingDebt > 0 ? '#dc2626' : '#16a34a', fontSize: '1.3rem' }}>
              {formatNumber(client.remainingDebt)}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Form — FEAT-04: method + FIFO/sale-picker + live TVA preview */}
      {client.remainingDebt > 0 && (
        <div className="card" style={{ marginBottom: '24px', borderColor: '#fbbf24', borderWidth: '2px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
            تسجيل دفعة جديدة
          </h3>
          <form onSubmit={handlePayment}>
            <div className="form-grid">
              <div className="form-group">
                <label>المبلغ (€) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  placeholder="0"
                  required
                />
              </div>
              <div className="form-group">
                <label>طريقة الدفع *</label>
                <div className="radio-group" style={{ marginTop: '6px' }}>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="collect-method"
                      value="كاش"
                      checked={paymentForm.paymentMethod === 'كاش'}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    />
                    كاش
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="collect-method"
                      value="بنك"
                      checked={paymentForm.paymentMethod === 'بنك'}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    />
                    بنك
                  </label>
                </div>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>الطلب (اختياري)</label>
                <select
                  value={paymentForm.saleId}
                  onChange={(e) => setPaymentForm({ ...paymentForm, saleId: e.target.value })}
                >
                  <option value="">FIFO — توزيع تلقائي على الطلبات الأقدم أولاً</option>
                  {openSales.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} — {s.date} — متبقي {formatNumber(s.remaining)} €
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '8px 0 12px' }}>
              TVA المحتسبة (20%): <strong>{formatNumber(tvaPreview)}</strong> €
            </div>
            <button type="submit" className="btn btn-success" disabled={submitting}>
              {submitting ? 'جاري التسجيل...' : 'تسجيل الدفعة'}
            </button>
          </form>
        </div>
      )}

      {/* Sales History */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المبيعات ({sales.length})
          </h3>
        </div>
        {sales.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}><h3>لا توجد مبيعات</h3></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي</th>
                  <th>الدفع</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.item}</td>
                    <td className="number-cell">{formatNumber(row.quantity)}</td>
                    <td className="number-cell">{formatNumber(row.unit_price)}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.total)}</td>
                    <td>
                      <span className="status-badge" style={{
                        background: row.payment_type === 'بنك' ? '#dbeafe' : row.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7',
                        color: row.payment_type === 'بنك' ? '#1e40af' : row.payment_type === 'آجل' ? '#d97706' : '#16a34a'
                      }}>
                        {row.payment_type || 'كاش'}
                      </span>
                    </td>
                    <td className="number-cell">{formatNumber(row.paid_amount)}</td>
                    <td className="number-cell" style={{ color: parseFloat(row.remaining) > 0 ? '#dc2626' : '#16a34a' }}>
                      {formatNumber(row.remaining)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payments History */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل الدفعات ({payments.length})
          </h3>
        </div>
        {payments.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}><h3>لا توجد دفعات مسجلة</h3></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>{formatNumber(row.amount)}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function ClientDetailPage({ params }) {
  return (
    <ToastProvider>
      <ClientDetailContent params={params} />
    </ToastProvider>
  );
}
