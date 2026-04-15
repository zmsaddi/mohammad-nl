'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import DetailModal from '@/components/DetailModal';
import { formatNumber } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';

function InvoicesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;
  const canSeeCosts = role === 'admin' || role === 'manager';
  // DONE: Bug 6 — drivers may now reach this page; the API filters their invoices
  // by joining on deliveries.assigned_driver. No client-side gating needed beyond auth.
  // eslint-disable-next-line no-unused-vars
  const canView = ['admin', 'manager', 'seller', 'driver'].includes(role);

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/invoices', { cache: 'no-store' });
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const filtered = invoices.filter((inv) =>
    inv.client_name?.includes(search) || inv.ref_code?.includes(search) || inv.item?.includes(search) || inv.vin?.includes(search)
  );

  // Item 3 — click-to-sort, default newest first
  const { sortedRows, requestSort, getSortIndicator } = useSortedRows(
    filtered,
    { key: 'date', direction: 'desc' }
  );

  return (
    <AppLayout>
      <div className="page-header">
        <h2>الفواتير</h2>
        <p>فواتير المبيعات المؤكدة بعد التوصيل</p>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            الفواتير ({filtered.length})
          </h3>
          <input
            type="text"
            placeholder="بحث بالاسم أو الكود أو VIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '8px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem', minWidth: '200px' }}
          />
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد فواتير</h3>
            <p>الفواتير تُنشأ تلقائياً عند تأكيد التوصيل</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('ref_code')} style={{ cursor: 'pointer' }}>رقم الفاتورة{getSortIndicator('ref_code')}</th>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('client_name')} style={{ cursor: 'pointer' }}>العميل{getSortIndicator('client_name')}</th>
                  <th onClick={() => requestSort('item')} style={{ cursor: 'pointer' }}>المنتج{getSortIndicator('item')}</th>
                  <th onClick={() => requestSort('quantity')} style={{ cursor: 'pointer' }}>الكمية{getSortIndicator('quantity')}</th>
                  <th onClick={() => requestSort('total')} style={{ cursor: 'pointer' }}>الإجمالي{getSortIndicator('total')}</th>
                  <th onClick={() => requestSort('payment_type')} style={{ cursor: 'pointer' }}>الدفع{getSortIndicator('payment_type')}</th>
                  <th onClick={() => requestSort('vin')} style={{ cursor: 'pointer' }}>VIN{getSortIndicator('vin')}</th>
                  <th onClick={() => requestSort('seller_name')} style={{ cursor: 'pointer' }}>البائع{getSortIndicator('seller_name')}</th>
                  <th>الفاتورة</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((inv) => (
                  <tr key={inv.id} className="clickable-row" onClick={() => setSelectedInvoice(inv)}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{inv.ref_code}</td>
                    <td>{inv.date}</td>
                    <td style={{ fontWeight: 600 }}>{inv.client_name}</td>
                    <td>{inv.item}</td>
                    <td className="number-cell">{formatNumber(inv.quantity)}</td>
                    <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(inv.total)}</td>
                    <td>
                      <span className="status-badge" style={{
                        background: inv.payment_type === 'بنك' ? '#dbeafe' : inv.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7',
                        color: inv.payment_type === 'بنك' ? '#1e40af' : inv.payment_type === 'آجل' ? '#d97706' : '#16a34a'
                      }}>
                        {inv.payment_type || 'كاش'}
                      </span>
                    </td>
                    <td style={{ direction: 'ltr', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: '#4f46e5' }}>{inv.vin || '-'}</td>
                    <td>{inv.seller_name}</td>
                    {/* DONE: Step 4 — open the French invoice in a new tab; user prints with Ctrl+P */}
                    <td>
                      <button
                        className="btn btn-sm"
                        style={{ background: '#1a3a2a', color: 'white', padding: '4px 10px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/api/invoices/${inv.ref_code}/pdf`, '_blank');
                        }}
                        title="Télécharger la facture PDF"
                      >
                        📄 PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DetailModal
        isOpen={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        title={selectedInvoice ? `فاتورة ${selectedInvoice.ref_code}` : ''}
        fields={selectedInvoice ? [
          { label: 'رقم الفاتورة', value: selectedInvoice.ref_code, color: '#6366f1' },
          { label: 'التاريخ', value: selectedInvoice.date },
          { type: 'divider' },
          { label: 'العميل', value: selectedInvoice.client_name },
          { label: 'الهاتف', value: selectedInvoice.client_phone, ltr: true },
          { label: 'الإيميل', value: selectedInvoice.client_email, ltr: true },
          { label: 'العنوان', value: selectedInvoice.client_address },
          { type: 'divider' },
          { label: 'المنتج', value: selectedInvoice.item },
          { label: 'الكمية', value: String(selectedInvoice.quantity) },
          { label: 'سعر الوحدة', type: 'money', value: selectedInvoice.unit_price },
          { label: 'الإجمالي', type: 'money', value: selectedInvoice.total },
          { type: 'divider' },
          { label: 'طريقة الدفع', type: 'badge', value: selectedInvoice.payment_type || 'كاش', bg: selectedInvoice.payment_type === 'بنك' ? '#dbeafe' : selectedInvoice.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7', color: selectedInvoice.payment_type === 'بنك' ? '#1e40af' : selectedInvoice.payment_type === 'آجل' ? '#d97706' : '#16a34a' },
          ...(selectedInvoice.vin ? [{ label: 'رقم الهيكل (VIN)', value: selectedInvoice.vin, color: '#4f46e5' }] : []),
          { type: 'divider' },
          { label: 'البائع', value: selectedInvoice.seller_name },
          { label: 'السائق', value: selectedInvoice.driver_name || '-' },
        ] : []}
      />
    </AppLayout>
  );
}

export default function InvoicesPage() {
  return <ToastProvider><InvoicesContent /></ToastProvider>;
}
