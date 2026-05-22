'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import DetailModal from '@/components/DetailModal';
import CancelSaleDialog from '@/components/CancelSaleDialog';
import { formatNumber, getTodayDate, numberInputProps } from '@/lib/utils';
import { useSortedRows } from '@/lib/use-sorted-rows';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { useUrlFilters } from '@/lib/use-url-filters';
import { dateInRange } from '@/lib/filter-engine';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import ErrorState from '@/components/ErrorState';
import FilterSheet from '@/components/FilterSheet';
import Pagination, { usePagination } from '@/components/Pagination';

const DELIVERY_FILTERS = { status: { default: '' }, from: { default: '', debounce: 400 }, to: { default: '', debounce: 400 }, driver: { default: 'all' }, bank: { default: '' } };

// Three workflow states the user picks from: قيد الانتظار / تم التسليم / إلغاء.
// 'جاري التوصيل' is kept here ONLY so legacy rows that still have it render with
// a style (it stays valid in the schema + driver-assignment logic), but it is
// `legacy` so it is never offered as a selectable option anymore.
const DELIVERY_STATUSES = [
  { value: 'قيد الانتظار', label: 'قيد الانتظار', color: '#f59e0b', bg: '#fef3c7' },
  { value: 'جاري التوصيل', label: 'جاري التوصيل', color: '#3b82f6', bg: '#dbeafe', legacy: true },
  { value: 'تم التوصيل', label: 'تم التسليم', color: '#16a34a', bg: '#dcfce7' },
  { value: 'ملغي', label: 'إلغاء', color: '#dc2626', bg: '#fee2e2' },
];
// Selectable subset (the 3 states) used for every dropdown.
const SELECTABLE_STATUSES = DELIVERY_STATUSES.filter((s) => !s.legacy);

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

// DONE: Bug 5 — bike SKU detector. The backend already enforces this on PUT
// (returns 400 if bike + missing VIN). The UI mirrors the rule so we don't
// surface a "skip" button when the API will reject the request anyway.
function isBikeDelivery(delivery) {
  const keywords = ['bike', 'دراجة', 'ebike', 'e-bike', 'scooter', 'sur-ron', 'aperyder'];
  return keywords.some((k) => (delivery?.items || '').toLowerCase().includes(k));
}

// v1.2 — VIN confirmation modal, extracted as a stable module-scope
// component. The production bug drivers reported was: "typing in the VIN
// field requires clicking the field after every letter." The previous
// implementation had three compounding issues that only showed up on
// mobile keyboards:
//
//   (1) An IIFE (`(() => { return <...> })()`) wrapped the modal JSX
//       inside the parent render. The IIFE itself is fine, but combined
//       with an onChange that transformed the value (toUpperCase), the
//       controlled input's value prop changed identity on every render
//       — some mobile browsers drop the IME selection when that happens,
//       which looks like a focus loss.
//   (2) `value={vinInput}` + `onChange={(e) => setVinInput(e.target.
//       value.toUpperCase())}` — the JS-side uppercase transform forces
//       React to reconcile the input's value on every keystroke, and
//       the cursor position is re-applied. iOS Safari + some Android
//       keyboards treat this as "input was externally edited" and drop
//       the keyboard.
//   (3) `autoFocus` on a controlled input inside a conditional render
//       only fires on the initial mount. Subsequent re-renders don't
//       re-focus, but if the parent tree briefly unmounts (e.g. NextAuth
//       session refresh toggling the loading overlay) the focus is lost
//       with no way to recover.
//
// Fixes applied here:
//   - Local state (ref) holds the raw typed value; the parent's
//     vinInput state is only updated via the onChange callback. The
//     parent no longer re-renders this subtree when its own other state
//     shifts.
//   - CSS `text-transform: uppercase` visually uppercases, no JS
//     transform — the cursor position stays put.
//   - The value is uppercased ONCE on submit.
//   - A useRef + useEffect focuses the input on open and is a no-op on
//     re-render, which handles the rare session-refresh remount cleanly.
function VinStepModal({ row, initialValue, onConfirm, onBack }) {
  const [vin, setVin] = useState(initialValue || '');
  const inputRef = useRef(null);
  const requireVin = isBikeDelivery(row);
  const vinReady = vin.trim().length > 0;

  useEffect(() => {
    // Focus once on mount. Guarded by a tick because some browsers
    // ignore focus() calls while a modal is still animating in.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <h3>
          رقم الهيكل (VIN)
          {requireVin && <span style={{ color: '#dc2626', fontSize: '0.85rem' }}> *مطلوب للدراجات</span>}
        </h3>
        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
          {requireVin
            ? 'هذه دراجة — يجب إدخال رقم الهيكل قبل تأكيد التوصيل.'
            : 'هذا المنتج ليس دراجة — يمكنك تخطي رقم الهيكل.'}
        </p>
        <div className="form-group" style={{ margin: '16px 0' }}>
          <input
            ref={inputRef}
            type="text"
            value={vin}
            onChange={(e) => setVin(e.target.value)}
            placeholder="مثال: WB10A1234Z5678"
            style={{
              direction: 'ltr',
              textAlign: 'center',
              fontSize: '1.1rem',
              fontWeight: 600,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              border: requireVin && !vinReady ? '2px solid #dc2626' : undefined,
            }}
          />
        </div>
        <div className="modal-actions">
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={requireVin && !vinReady}
            onClick={() => onConfirm(vin.trim().toUpperCase())}
          >
            {requireVin ? 'تأكيد مع VIN' : (vinReady ? 'تأكيد مع VIN' : 'تخطي وتأكيد')}
          </button>
          <button className="btn btn-outline" onClick={onBack}>رجوع</button>
        </div>
      </div>
    </div>
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
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const canAssignDriver = ['admin', 'manager'].includes(userRole);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [confirmDelivery, setConfirmDelivery] = useState(null); // {row, step: 'amount'|'vin'}
  const [vinInput, setVinInput] = useState('');
  // Filters URL-synced via the shared hook. bankPendingOnly is encoded as bank==='1'.
  const { values: f, set: setF, reset: resetFilters, isActive: filtersActive } = useUrlFilters(DELIVERY_FILTERS);
  const bankPendingOnly = f.bank === '1';
  const [showForm, setShowForm] = useState(false);
  // FEAT-05: cancellation dialog state. When an admin clicks the status
  // dropdown to 'ملغي' OR the delete button, we open the CancelSaleDialog
  // and let it drive the full cancellation flow through the new endpoints.
  const [cancelSale, setCancelSale] = useState(null); // {saleId, invoiceMode}
  const [pendingStatus, setPendingStatus] = useState(null); // {row, newStatus}

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

  // Assign driver to a delivery (admin/manager only)
  const handleAssignDriver = async (deliveryId, driverUsername) => {
    try {
      // Read the current delivery row to build a complete PUT body
      const current = rows.find(r => r.id === deliveryId);
      if (!current) return;
      const res = await fetch('/api/deliveries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: deliveryId,
          date: current.date?.slice?.(0, 10) || current.date,
          clientName: current.client_name,
          clientPhone: current.client_phone || '',
          address: current.address || '',
          items: current.items,
          totalAmount: current.total_amount || 0,
          status: current.status,
          driverName: driverUsername,
          assignedDriver: driverUsername,
          notes: current.notes || '',
          vin: current.vin || '',
        }),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast(driverUsername ? `تم تعيين السائق: ${driverUsername}` : 'تم إلغاء تعيين السائق');
        fetchData();
      } else {
        const d = await res.json();
        addToast(d.error || 'خطأ في تعيين السائق', 'error');
      }
    } catch { addToast('خطأ في الاتصال', 'error'); }
  };

  const fetchData = async () => {
    try {
      setError(false);
      // Only admin/manager need the users list (for driver-assignment dropdown).
      // Drivers don't see the dropdown so skip the fetch to avoid a 403 console error.
      const fetches = [
        fetch('/api/deliveries', { cache: 'no-store' }),
        fetch('/api/clients', { cache: 'no-store' }),
      ];
      if (canAssignDriver) {
        fetches.push(fetch('/api/users', { cache: 'no-store' }).catch(() => ({ ok: false })));
      }
      const [deliveriesRes, clientsRes, usersRes] = await Promise.all(fetches);
      if (!deliveriesRes.ok) throw new Error(`HTTP ${deliveriesRes.status}`);
      const deliveriesData = await deliveriesRes.json();
      const clientsData = await clientsRes.json();
      if (usersRes?.ok) {
        const usersData = await usersRes.json();
        setDrivers((Array.isArray(usersData) ? usersData : []).filter(u => u.role === 'driver' && u.active));
      }
      setRows(Array.isArray(deliveriesData) ? deliveriesData : []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
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
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم إضافة التوصيلة بنجاح');
        setForm({ date: getTodayDate(), clientName: '', clientPhone: '', clientEmail: '', address: '', items: '', totalAmount: '', driverName: '', notes: '' });
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

  // Admin/manager confirms bank funds arrived → records the bank payment
  // (attributed to the confirmer) and unblocks delivery for this sale.
  const handleConfirmBank = async (saleId) => {
    if (!saleId) { addToast('لا يوجد بيع مرتبط', 'error'); return; }
    try {
      const res = await fetch(`/api/sales/${saleId}/confirm-bank`, { method: 'POST', cache: 'no-store' });
      if (res.ok) { addToast('تم تأكيد استلام المبلغ البنكي'); fetchData(); }
      else { const d = await res.json(); addToast(d.error || 'خطأ', 'error'); }
    } catch { addToast('خطأ في الاتصال', 'error'); }
  };

  const handleStatusChange = async (row, newStatus) => {
    // If confirming delivery, show confirmation flow
    if (newStatus === 'تم التوصيل') {
      setConfirmDelivery({ row, step: 'amount' });
      setVinInput('');
      return;
    }
    // FEAT-05: cancellation goes through the CancelSaleDialog (bonus
    // keep/remove choice + audit row). The old inline PUT path no longer
    // runs — cancelSale handles everything atomically.
    if (newStatus === 'ملغي') {
      if (!row.sale_id) {
        addToast('لا يمكن إلغاء توصيل غير مرتبط ببيع', 'error');
        return;
      }
      setCancelSale({ saleId: row.sale_id, invoiceMode: 'soft' });
      return;
    }
    // Generic status changes get a confirmation modal
    setPendingStatus({ row, newStatus });
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
        cache: 'no-store',
      });
      if (res.ok) {
        addToast(`تم تحديث الحالة إلى: ${newStatus}`);
        fetchData();
      }
    } catch {
      addToast('خطأ في تحديث الحالة', 'error');
    }
  };


  // A بنك sale awaiting admin/manager bank-receipt confirmation (blocks delivery).
  const isBankPending = (r) =>
    r.sale_payment_type === 'بنك' && !r.bank_received_by &&
    r.status !== 'ملغي' && r.status !== 'تم التوصيل';

  // Item 2 — status + date range + driver + bank-pending toggle (shared engine)
  const filtered = useMemo(() => rows.filter((r) => {
    if (bankPendingOnly && !isBankPending(r)) return false;
    if (f.status && r.status !== f.status) return false;
    if (!dateInRange(r.date, f.from, f.to)) return false;
    if (f.driver !== 'all' && (r.assigned_driver || '') !== f.driver) return false;
    return true;
  }), [rows, f.status, f.from, f.to, f.driver, bankPendingOnly]);
  // Smart sort: pending/in-transit first, then by date newest
  const STATUS_PRIORITY = { 'قيد الانتظار': 0, 'جاري التوصيل': 1, 'تم التوصيل': 2, 'ملغي': 3 };
  const smartFiltered = [...filtered].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 9;
    const pb = STATUS_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return (b.id || 0) - (a.id || 0);
  });
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    smartFiltered,
    { key: null, direction: null }
  );
  // PA-03: Pagination
  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows, resetPage } = usePagination(sortedRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { resetPage(); }, [f.status, f.from, f.to, f.driver, f.bank]);

  // Driver dropdown options derived from row data
  const driverOptions = Array.from(
    new Set(rows.map((r) => r.assigned_driver).filter(Boolean))
  );

  // Stats
  const pending = rows.filter((r) => r.status === 'قيد الانتظار').length;
  const inTransit = rows.filter((r) => r.status === 'جاري التوصيل').length;
  const delivered = rows.filter((r) => r.status === 'تم التوصيل').length;
  const cancelled = rows.filter((r) => r.status === 'ملغي').length;
  const bankPendingCount = rows.filter(isBankPending).length;

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
        <div
          className="summary-card"
          style={{ cursor: 'pointer', outline: bankPendingOnly ? '2px solid #ea580c' : 'none' }}
          onClick={() => setF('bank', bankPendingOnly ? '' : '1')}
          title="بيوع بنكية تنتظر تأكيد استلام المبلغ قبل التسليم"
        >
          <div className="summary-card-icon" style={{ background: '#ffedd5' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#ea580c" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          </div>
          <div className="summary-card-content">
            <h3>بنك: بانتظار التأكيد</h3>
            <div className="value" style={{ color: '#ea580c' }}>{bankPendingCount}</div>
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
                <input id="del-amount" {...numberInputProps} min="0" step="any" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="0" />
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل التوصيلات ({sortedRows.length}/{rows.length})
          </h3>
          {!showForm && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
              + توصيلة جديدة
            </button>
          )}
        </div>

        {/* Item 2 — filter bar — wrapped in FilterSheet (mobile bottom sheet; desktop inline). */}
        <FilterSheet
          isActive={filtersActive}
          onClear={resetFilters}
          chips={[
            f.from && { label: `من ${f.from}`, onRemove: () => setF('from', '') },
            f.to && { label: `إلى ${f.to}`, onRemove: () => setF('to', '') },
            f.status && { label: f.status, onRemove: () => setF('status', '') },
            f.driver !== 'all' && { label: f.driver, onRemove: () => setF('driver', 'all') },
          ].filter(Boolean)}
        >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.85rem' }}>
          <input type="date" value={f.from} onChange={(e) => setF('from', e.target.value)} aria-label="من تاريخ" className="filter-control" />
          <input type="date" value={f.to} onChange={(e) => setF('to', e.target.value)} aria-label="إلى تاريخ" className="filter-control" />
          <select
            value={f.status}
            onChange={(e) => setF('status', e.target.value)}
            aria-label="تصفية حسب الحالة"
            className="filter-control"
          >
            <option value="">كل الحالات</option>
            {SELECTABLE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            value={f.driver}
            onChange={(e) => setF('driver', e.target.value)}
            aria-label="تصفية حسب السائق"
            className="filter-control"
          >
            <option value="all">كل السائقين</option>
            {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {filtersActive && (
            <button type="button" className="btn btn-outline btn-sm" onClick={resetFilters}>
              ✕ مسح
            </button>
          )}
        </div>
        </FilterSheet>

        {loading ? (
          <PageSkeleton rows={6} />
        ) : error ? (
          <ErrorState onRetry={fetchData} />
        ) : paginatedRows.length === 0 ? (
          <div className="empty-state">
            <TruckIcon size={64} color="#94a3b8" />
            <h3>{rows.length === 0 ? 'لا توجد توصيلات بعد' : 'لا توجد نتائج مطابقة'}</h3>
            <p>{rows.length === 0 ? 'أضف أول توصيلة بالضغط على الزر أعلاه' : 'جرّب تعديل الفلاتر أو مسحها'}</p>
            {rows.length > 0 && filtersActive && (
              <button className="btn btn-sm btn-clear" style={{ marginTop: 8 }} onClick={resetFilters}>✕ مسح الفلاتر</button>
            )}
          </div>
        ) : (
          <>
          {/* v1.1 S3.2 — mobile card fallback: visible below 768px, hidden at 768px+ */}
          <DataCardList
            rows={paginatedRows}
            fields={[
              { key: 'ref_code', label: 'الكود', format: (v, r) => v || `DL-${r.id}` },
              { key: 'date', label: 'التاريخ' },
              { key: 'client_name', label: 'العميل' },
              { key: 'client_phone', label: 'الهاتف' },
              { key: 'address', label: 'العنوان' },
              { key: 'items', label: 'الأصناف' },
              { key: 'total_amount', label: 'المبلغ', format: (v) => v ? `${formatNumber(v)} €` : '—' },
              { key: 'assigned_driver', label: 'السائق', format: (v) => v || '—' },
            ]}
            statusField="status"
            statusColors={{
              'قيد الانتظار': '#f59e0b',
              'جاري التوصيل': '#3b82f6',
              'تم التوصيل': '#16a34a',
              'ملغي': '#dc2626',
            }}
            actions={(row) => (
              <>
                {/* v1.2 — status-change select added to mobile card.
                    Previously only "تفاصيل" / "إلغاء" / "تعيين سائق" buttons
                    showed on mobile, leaving drivers no way to mark a
                    delivery as "تم التوصيل" from the phone. The desktop
                    table has this select in the status column; the card
                    actions block now mirrors it so mobile parity holds. */}
                {canChangeStatus && (
                  <select
                    value={row.status}
                    onChange={(e) => handleStatusChange(row, e.target.value)}
                    style={{
                      flex: 2,
                      padding: '6px 10px',
                      border: 'none',
                      borderRadius: '20px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      fontFamily: "'Cairo', sans-serif",
                      cursor: 'pointer',
                      ...getStatusStyle(row.status),
                    }}
                  >
                    {SELECTABLE_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                )}
                {canAssignDriver && row.status !== 'تم التوصيل' && row.status !== 'ملغي' && (
                  <select
                    value={row.assigned_driver || ''}
                    onChange={(e) => handleAssignDriver(row.id, e.target.value)}
                    className="btn btn-outline btn-sm"
                    style={{ flex: 2, fontFamily: "'Cairo', sans-serif", fontSize: '0.82rem' }}
                  >
                    <option value="">تعيين سائق...</option>
                    {drivers.map(d => (
                      <option key={d.username} value={d.username}>{d.name || d.username}</option>
                    ))}
                  </select>
                )}
                {isBankPending(row) && (
                  <span className="status-badge" style={{ background: '#ffedd5', color: '#ea580c', fontSize: '0.72rem' }}>بنك: بانتظار التأكيد</span>
                )}
                {canAssignDriver && isBankPending(row) && (
                  <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '3px 10px', fontSize: '0.78rem', whiteSpace: 'nowrap' }} onClick={() => handleConfirmBank(row.sale_id)}>✓ تأكيد البنك</button>
                )}
                <button className="btn btn-primary btn-sm" onClick={() => setSelectedRow(row)}>تفاصيل</button>
                {isAdmin && row.status !== 'ملغي' && row.sale_id && (
                  <button className="btn btn-danger btn-sm" onClick={() => setCancelSale({ saleId: row.sale_id, invoiceMode: 'soft' })}>إلغاء</button>
                )}
              </>
            )}
            emptyMessage="لا توجد توصيلات"
          />
          {/* Desktop table: hidden below 768px when card fallback is active */}
          <div className="table-container has-card-fallback">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('ref_code')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('ref_code')}>الكود{getSortIndicator('ref_code')}</th>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('date')}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('client_name')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('client_name')}>العميل{getSortIndicator('client_name')}</th>
                  <th onClick={() => requestSort('client_phone')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('client_phone')}>الهاتف{getSortIndicator('client_phone')}</th>
                  <th onClick={() => requestSort('address')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('address')}>العنوان{getSortIndicator('address')}</th>
                  <th onClick={() => requestSort('items')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('items')}>الأصناف{getSortIndicator('items')}</th>
                  <th onClick={() => requestSort('total_amount')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('total_amount')}>المبلغ{getSortIndicator('total_amount')}</th>
                  <th onClick={() => requestSort('assigned_driver')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('assigned_driver')}>السائق{getSortIndicator('assigned_driver')}</th>
                  <th onClick={() => requestSort('status')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('status')}>الحالة{getSortIndicator('status')}</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.ref_code || `DL-${row.id}`}</td>
                    <td>{row.date}</td>
                    <td style={{ fontWeight: 600 }}>{row.client_name}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{row.client_phone}</td>
                    <td>{row.address}</td>
                    <td>{row.items}</td>
                    <td className="number-cell">{row.total_amount ? formatNumber(row.total_amount) : '-'}</td>
                    <td>
                      {canAssignDriver && row.status !== 'تم التوصيل' && row.status !== 'ملغي' ? (
                        <select
                          value={row.assigned_driver || ''}
                          onChange={(e) => handleAssignDriver(row.id, e.target.value)}
                          style={{
                            padding: '4px 8px',
                            border: '1.5px solid #d1d5db',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontFamily: "'Cairo', sans-serif",
                            background: row.assigned_driver ? '#dcfce7' : '#fef3c7',
                            cursor: 'pointer',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">-- غير معيّن --</option>
                          {drivers.map(d => (
                            <option key={d.username} value={d.username}>{d.name || d.username}</option>
                          ))}
                        </select>
                      ) : (
                        row.assigned_driver || row.driver_name || '-'
                      )}
                    </td>
                    {/* v1.2 — status-change cell now stops click propagation.
                        Without this, tapping the select bubbled up to the
                        row's onClick, which opens setSelectedRow(row) — the
                        DetailModal then rendered on top BEFORE the native
                        dropdown could even open, so drivers saw the select
                        "keep closing without letting me pick". The
                        driver-assign select on the previous cell already
                        had e.stopPropagation; this one was missed. Same
                        treatment now. */}
                    <td onClick={(e) => e.stopPropagation()}>
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
                        {SELECTABLE_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      ) : (
                        <span className="status-badge" style={getStatusStyle(row.status)}>{row.status}</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canAssignDriver && isBankPending(row) && (
                        <button
                          className="btn btn-sm"
                          style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '3px 10px', fontSize: '0.78rem', whiteSpace: 'nowrap', marginLeft: 4 }}
                          onClick={() => handleConfirmBank(row.sale_id)}
                        >
                          ✓ تأكيد البنك
                        </button>
                      )}
                      {isAdmin && row.status !== 'ملغي' && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (!row.sale_id) {
                              addToast('لا يمكن إلغاء توصيل غير مرتبط ببيع', 'error');
                              return;
                            }
                            setCancelSale({ saleId: row.sale_id, invoiceMode: 'soft' });
                          }}
                        >
                          إلغاء
                        </button>
                      )}
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
      {/* Hotfix 2026-04-14: backdrop onClick removed on both steps so
          drivers can't accidentally dismiss the confirm flow and lose
          their place (step 2 has a VIN input which the driver has to
          enter carefully). Only the explicit "إلغاء" button and the
          "تأكيد" button close the flow. */}
      {confirmDelivery && confirmDelivery.step === 'amount' && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h3>تأكيد التوصيل</h3>
            <div style={{ margin: '16px 0', padding: '16px', background: '#f8fafc', borderRadius: '12px' }}>
              <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '0.85rem' }}>العميل: <strong style={{ color: '#1e293b' }}>{confirmDelivery.row.client_name}</strong></div>
              <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '0.85rem' }}>الأصناف: <strong style={{ color: '#1e293b' }}>{confirmDelivery.row.items}</strong></div>
              {/* FEAT-04: driver collects the down_payment_expected amount
                  set by the seller, NOT the full total. The BUG-04 rebuild
                  pattern at app/api/deliveries/route.js already strips any
                  driver-sent amounts from the PUT body, so display-only is
                  safe. When dpe is 0 (pure credit sale) show "credit" pill;
                  when dpe > 0 show the exact amount to collect + any
                  remainder as a "debt" hint. */}
              {(() => {
                const dpe = parseFloat(confirmDelivery.row.down_payment_expected) || 0;
                const totalAmt = parseFloat(confirmDelivery.row.total_amount) || 0;
                const salePaymentType = confirmDelivery.row.sale_payment_type || confirmDelivery.row.payment_type;
                const remainingAfter = Math.max(0, totalAmt - dpe);

                if (totalAmt <= 0) return null;

                if (dpe <= 0 && salePaymentType === 'آجل') {
                  return (
                    <div style={{ padding: '12px', background: '#fef3c7', borderRadius: '10px', textAlign: 'center', marginTop: '12px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>دين على العميل — لا تحصّل شيء الآن</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#d97706' }}>
                        إجمالي الدين: {formatNumber(totalAmt)}
                      </div>
                    </div>
                  );
                }

                return (
                  <div style={{ padding: '12px', background: remainingAfter > 0 ? '#ffedd5' : '#dcfce7', borderRadius: '10px', textAlign: 'center', marginTop: '12px' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      المبلغ المطلوب تحصيله الآن
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: remainingAfter > 0 ? '#9a3412' : '#16a34a' }}>
                      {formatNumber(dpe)}
                    </div>
                    {remainingAfter > 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: '6px' }}>
                        المتبقي بعد هذه الدفعة: {formatNumber(remainingAfter)} (يُحصّل لاحقاً)
                      </div>
                    )}
                  </div>
                );
              })()}
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

      {/* DONE: Bug 5 — VIN required for bikes; non-bike deliveries can still skip.
          v1.2 — extracted to VinStepModal (module-scope) to stop mobile keyboards
          from dropping focus on each keystroke. See the long docblock on the
          component for the full explanation. */}
      {confirmDelivery && confirmDelivery.step === 'vin' && (
        <VinStepModal
          row={confirmDelivery.row}
          initialValue={vinInput}
          onConfirm={async (vin) => {
            const needed = isBikeDelivery(confirmDelivery.row);
            if (needed && !vin) {
              addToast('رقم VIN مطلوب لتأكيد توصيل الدراجة', 'error');
              return;
            }
            await doStatusChange(confirmDelivery.row, 'تم التوصيل', vin);
            setConfirmDelivery(null);
            setVinInput('');
          }}
          onBack={() => setConfirmDelivery({ ...confirmDelivery, step: 'amount' })}
        />
      )}

      {/* UX-03: Confirm generic status changes (not تم التوصيل / ملغي) */}
      <ConfirmModal
        isOpen={!!pendingStatus}
        title="تغيير الحالة"
        message={pendingStatus ? `هل تريد تغيير حالة التوصيلة إلى ${pendingStatus.newStatus}؟` : ''}
        confirmText="نعم، تغيير"
        confirmClass="btn-primary"
        onConfirm={async () => {
          if (pendingStatus) {
            await doStatusChange(pendingStatus.row, pendingStatus.newStatus, '');
          }
          setPendingStatus(null);
        }}
        onCancel={() => setPendingStatus(null)}
      />

      {/* FEAT-05: cancellation dialog — triggered by status→ملغي or by the
          admin delete button. Drives the full cancelSale flow via the new
          POST /api/sales/[id]/cancel endpoint. */}
      {cancelSale && (
        <CancelSaleDialog
          saleId={cancelSale.saleId}
          invoiceMode={cancelSale.invoiceMode}
          title="إلغاء الطلب المرتبط"
          onSuccess={() => {
            setCancelSale(null);
            addToast('تم إلغاء الطلب بنجاح');
            fetchData();
          }}
          onCancel={() => setCancelSale(null)}
        />
      )}
    </AppLayout>
  );
}

export default function DeliveriesPage() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <DeliveriesContent />
      </Suspense>
    </ToastProvider>
  );
}
