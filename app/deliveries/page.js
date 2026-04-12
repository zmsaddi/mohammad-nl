'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import { formatNumber, getTodayDate } from '@/lib/utils';

const DELIVERY_STATUSES = [
  { value: 'قيد الانتظار', label: 'قيد الانتظار', color: '#f59e0b', bg: '#fef3c7' },
  { value: 'جاري التوصيل', label: 'جاري التوصيل', color: '#3b82f6', bg: '#dbeafe' },
  { value: 'تم التوصيل', label: 'تم التوصيل', color: '#16a34a', bg: '#dcfce7' },
  { value: 'ملغي', label: 'ملغي', color: '#dc2626', bg: '#fee2e2' },
];

function getStatusStyle(status) {
  const s = DELIVERY_STATUSES.find((d) => d.value === status);
  return s ? { background: s.bg, color: s.color } : {};
}

// Delivery truck SVG icon
function TruckIcon({ size = 24, color = 'currentColor' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={color} width={size} height={size}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

function DeliveriesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const userRole = session?.user?.role;
  const isAdmin = userRole === 'admin';
  const canChangeStatus = ['admin', 'manager', 'driver'].includes(userRole);

  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [confirmDelivery, setConfirmDelivery] = useState(null); // {row, step: 'amount'|'vin'}
  const [vinInput, setVinInput] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    date: getTodayDate(),
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    address: '',
    items: '',
    totalAmount: '',
    driverName: '',
    notes: '',
  });

  const fetchData = async () => {
    try {
      const [deliveriesRes, clientsRes] = await Promise.all([
        fetch('/api/deliveries'),
        fetch('/api/clients'),
      ]);
      const deliveriesData = await deliveriesRes.json();
      const clientsData = await clientsRes.json();
      setRows(Array.isArray(deliveriesData) ? deliveriesData.reverse() : []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  // Auto-fill phone when client is selected
  const handleClientChange = (name) => {
    setForm((prev) => {
      const client = clients.find((c) => c.name === name);
      return {
        ...prev,
        clientName: name,
        clientPhone: client ? client.phone || '' : prev.clientPhone,
        clientEmail: client ? client.email || '' : prev.clientEmail,
        address: client ? client.address || '' : prev.address,
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.clientName || !form.address || !form.items) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        addToast('تم إضافة التوصيلة بنجاح');
        setForm({ date: getTodayDate(), clientName: '', clientPhone: '', address: '', items: '', totalAmount: '', driverName: '', notes: '' });
        setShowForm(false);
        fetchData();
      } else {
        addToast('خطأ في إضافة البيانات', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (row, newStatus) => {
    // If confirming delivery, show confirmation flow
    if (newStatus === 'تم التوصيل') {
      setConfirmDelivery({ row, step: 'amount' });
      setVinInput('');
      return;
    }
    await doStatusChange(row, newStatus, '');
  };

  const doStatusChange = async (row, newStatus, vin) => {
    try {
      const res = await fetch('/api/deliveries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          date: row.date,
          clientName: row.client_name,
          clientPhone: row.client_phone,
          address: row.address,
          items: row.items,
          totalAmount: row.total_amount,
          status: newStatus,
          driverName: row.driver_name,
          assignedDriver: row.assigned_driver,
          notes: row.notes,
          vin: vin || '',
        }),
      });
      if (res.ok) {
        addToast(`تم تحديث الحالة إلى: ${newStatus}`);
        fetchData();
      }
    } catch {
      addToast('خطأ في تحديث الحالة', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/deliveries?id=${deleteId}`, { method: 'DELETE' });
      if (res.ok) {
        addToast('تم الحذف بنجاح');
        fetchData();
      }
    } catch {
      addToast('خطأ في الحذف', 'error');
    }
    setDeleteId(null);
  };

  const filtered = filterStatus ? rows.filter((r) => r.status === filterStatus) : rows;

  // Stats
  const pending = rows.filter((r) => r.status === 'قيد الانتظار').length;
  const inTransit = rows.filter((r) => r.status === 'جاري التوصيل').length;
  const delivered = rows.filter((r) => r.status === 'تم التوصيل').length;
  const cancelled = rows.filter((r) => r.status === 'ملغي').length;

  return (
    <AppLayout>
      <div className="page-header">
        <h2>التوصيل</h2>
        <p>تتبع توصيل الطلبات للعملاء</p>
      </div>

      {/* Stats Cards */}
      <div className="summary-cards" style={{ marginBottom: '24px' }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#fef3c7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#f59e0b" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="summary-card-content">
            <h3>قيد الانتظار</h3>
            <div className="value" style={{ color: '#f59e0b' }}>{pending}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
            <TruckIcon size={24} color="#3b82f6" />
          </div>
          <div className="summary-card-content">
            <h3>جاري التوصيل</h3>
            <div className="value" style={{ color: '#3b82f6' }}>{inTransit}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="summary-card-content">
            <h3>تم التوصيل</h3>
            <div className="value" style={{ color: '#16a34a' }}>{delivered}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#fee2e2' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#dc2626" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="summary-card-content">
            <h3>ملغي</h3>
            <div className="value" style={{ color: '#dc2626' }}>{cancelled}</div>
          </div>
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TruckIcon size={20} />
            إضافة توصيلة جديدة
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="del-date">التاريخ *</label>
                <input id="del-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label htmlFor="del-client">اسم العميل *</label>
                <input
                  id="del-client"
                  type="text"
                  list="delivery-clients-list"
                  value={form.clientName}
                  onChange={(e) => handleClientChange(e.target.value)}
                  placeholder="اختر أو أدخل اسم العميل"
                  required
                />
                <datalist id="delivery-clients-list">
                  {clients.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label htmlFor="del-phone">رقم الهاتف</label>
                <input id="del-phone" type="text" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="رقم هاتف العميل" />
              </div>
              <div className="form-group">
                <label htmlFor="del-address">العنوان *</label>
                <input id="del-address" type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="عنوان التوصيل" required />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="del-items">الأصناف *</label>
                <input id="del-items" type="text" value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} placeholder="مثال: 2 دراجة كهربائية، 3 بطاريات، 1 شاحن" required />
              </div>
              <div className="form-group">
                <label htmlFor="del-amount">المبلغ</label>
                <input id="del-amount" type="number" min="0" step="any" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="0" />
              </div>
              <div className="form-group">
                <label htmlFor="del-driver">اسم السائق</label>
                <input id="del-driver" type="text" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} placeholder="اسم السائق" />
              </div>
              <div className="form-group">
                <label htmlFor="del-notes">ملاحظات</label>
                <input id="del-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'جاري الإضافة...' : 'إضافة توصيلة'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {/* Deliveries Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل التوصيلات ({filtered.length})
          </h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            >
              <option value="">كل الحالات</option>
              {DELIVERY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {!showForm && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
                + توصيلة جديدة
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <TruckIcon size={64} color="#94a3b8" />
            <h3>{filterStatus ? 'لا توجد توصيلات بهذه الحالة' : 'لا توجد توصيلات بعد'}</h3>
            <p>أضف أول توصيلة بالضغط على الزر أعلاه</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الكود</th>
                  <th>التاريخ</th>
                  <th>العميل</th>
                  <th>الهاتف</th>
                  <th>العنوان</th>
                  <th>الأصناف</th>
                  <th>المبلغ</th>
                  <th>السائق</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.ref_code || `DL-${row.id}`}</td>
                    <td>{row.date}</td>
                    <td style={{ fontWeight: 600 }}>{row.client_name}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{row.client_phone}</td>
                    <td>{row.address}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.items}</td>
                    <td className="number-cell">{row.total_amount ? formatNumber(row.total_amount) : '-'}</td>
                    <td>{row.driver_name || '-'}</td>
                    <td>
                      {canChangeStatus ? (
                      <select
                        value={row.status}
                        onChange={(e) => handleStatusChange(row, e.target.value)}
                        style={{
                          padding: '4px 8px',
                          border: 'none',
                          borderRadius: '20px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          fontFamily: "'Cairo', sans-serif",
                          cursor: 'pointer',
                          ...getStatusStyle(row.status),
                        }}
                      >
                        {DELIVERY_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      ) : (
                        <span className="status-badge" style={getStatusStyle(row.status)}>{row.status}</span>
                      )}
                    </td>
                    <td>
                      {isAdmin && (
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>
                          حذف
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `توصيل ${selectedRow.ref_code || selectedRow.id}` : ''}
        fields={selectedRow ? [
          { label: 'الكود', value: selectedRow.ref_code || `DL-${selectedRow.id}`, color: '#6366f1' },
          { label: 'التاريخ', value: selectedRow.date },
          { type: 'divider' },
          { label: 'العميل', value: selectedRow.client_name },
          { label: 'الهاتف', value: selectedRow.client_phone, ltr: true },
          { label: 'الإيميل', value: selectedRow.client_email, ltr: true },
          { label: 'العنوان', value: selectedRow.address },
          { type: 'divider' },
          { label: 'الأصناف', value: selectedRow.items },
          { label: 'المبلغ', type: 'money', value: selectedRow.total_amount },
          { label: 'السائق', value: selectedRow.driver_name || selectedRow.assigned_driver || '-' },
          { label: 'الحالة', type: 'badge', value: selectedRow.status, bg: selectedRow.status === 'تم التوصيل' ? '#dcfce7' : selectedRow.status === 'ملغي' ? '#fee2e2' : selectedRow.status === 'جاري التوصيل' ? '#dbeafe' : '#fef3c7', color: selectedRow.status === 'تم التوصيل' ? '#16a34a' : selectedRow.status === 'ملغي' ? '#dc2626' : selectedRow.status === 'جاري التوصيل' ? '#3b82f6' : '#d97706' },
          ...(selectedRow.created_by ? [{ label: 'بواسطة', value: selectedRow.created_by }] : []),
          ...(selectedRow.notes ? [{ label: 'ملاحظات', value: selectedRow.notes }] : []),
        ] : []}
      />

      {/* Delivery Confirmation Flow */}
      {confirmDelivery && confirmDelivery.step === 'amount' && (
        <div className="modal-overlay" onClick={() => setConfirmDelivery(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h3>تأكيد التوصيل</h3>
            <div style={{ margin: '16px 0', padding: '16px', background: '#f8fafc', borderRadius: '12px' }}>
              <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '0.85rem' }}>العميل: <strong style={{ color: '#1e293b' }}>{confirmDelivery.row.client_name}</strong></div>
              <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '0.85rem' }}>الأصناف: <strong style={{ color: '#1e293b' }}>{confirmDelivery.row.items}</strong></div>
              {confirmDelivery.row.total_amount > 0 && (
                <div style={{ padding: '12px', background: confirmDelivery.row.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7', borderRadius: '10px', textAlign: 'center', marginTop: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {confirmDelivery.row.payment_type === 'آجل' ? 'دين على العميل' : 'المبلغ المطلوب تحصيله'}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: confirmDelivery.row.payment_type === 'آجل' ? '#d97706' : '#16a34a' }}>
                    {formatNumber(confirmDelivery.row.total_amount)}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setConfirmDelivery({ ...confirmDelivery, step: 'vin' })}>
                تأكيد ← التالي
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmDelivery(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelivery && confirmDelivery.step === 'vin' && (
        <div className="modal-overlay" onClick={() => setConfirmDelivery(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h3>رقم الهيكل (VIN)</h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>إذا المنتج دراجة كهربائية، أدخل رقم الهيكل. أو اضغط تخطي.</p>
            <div className="form-group" style={{ margin: '16px 0' }}>
              <input
                type="text"
                value={vinInput}
                onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                placeholder="مثال: WB10A1234Z5678"
                style={{ direction: 'ltr', textAlign: 'center', fontSize: '1.1rem', fontWeight: 600, letterSpacing: '2px' }}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={async () => {
                await doStatusChange(confirmDelivery.row, 'تم التوصيل', vinInput);
                setConfirmDelivery(null);
                setVinInput('');
              }}>
                {vinInput ? 'تأكيد مع VIN' : 'تخطي وتأكيد'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmDelivery({ ...confirmDelivery, step: 'amount' })}>رجوع</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف توصيلة"
        message="هل أنت متأكد من حذف هذه التوصيلة؟"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AppLayout>
  );
}

export default function DeliveriesPage() {
  return (
    <ToastProvider>
      <DeliveriesContent />
    </ToastProvider>
  );
}
