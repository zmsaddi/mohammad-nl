'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import CancelSaleDialog from '@/components/CancelSaleDialog';
import { formatNumber, getTodayDate } from '@/lib/utils';
import DetailModal from '@/components/DetailModal';
import SmartSelect from '@/components/SmartSelect';
import { canCancelSale } from '@/lib/cancel-rule';
import { useSortedRows } from '@/lib/use-sorted-rows';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import DataCardList from '@/components/DataCardList';
import PageSkeleton from '@/components/PageSkeleton';
import Pagination, { usePagination } from '@/components/Pagination';

function SalesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;
  const isAdmin = role === 'admin';
  const canSeeCosts = role === 'admin' || role === 'manager';
  const isSeller = role === 'seller';
  const currentUser = session?.user
    ? { role: session.user.role, username: session.user.username }
    : null;

  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [bonusSettings, setBonusSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  // Item 2 — filter state for /sales list
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPayStatus, setFilterPayStatus] = useState('all');
  const [filterSeller, setFilterSeller] = useState('all');
  // FEAT-05: cancellation dialog state. Admin "حذف" on a sale row opens the
  // CancelSaleDialog with invoiceMode='delete' — the dialog forces 'remove'
  // for both bonuses (keep option hidden) because of FK cascade rules.
  const [cancelSale, setCancelSale] = useState(null); // { saleId }
  const [whatsappShare, setWhatsappShare] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [editSale, setEditSale] = useState(null);
  const searchParams = useSearchParams();
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');

  const [form, setForm] = useState({
    date: getTodayDate(),
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    clientAddress: '',
    item: '',
    quantity: '',
    unitPrice: '',
    paymentType: 'كاش',
    downPaymentExpected: '',
    notes: '',
  });
  // FEAT-04: track whether user manually edited down_payment_expected so
  // we don't clobber their input on subsequent paymentType/total changes.
  const [downPaymentTouched, setDownPaymentTouched] = useState(false);

  // Smart auto-fill: when client name matches, fill all their info
  const handleClientChange = (name) => {
    const client = clients.find((c) => c.name === name);
    setForm((prev) => ({
      ...prev,
      clientName: name,
      clientPhone: client ? client.phone || prev.clientPhone : prev.clientPhone,
      clientEmail: client ? client.email || prev.clientEmail : prev.clientEmail,
      clientAddress: client ? client.address || prev.clientAddress : prev.clientAddress,
    }));
  };

  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitPrice) || 0);

  // v1.2 UX-1: derive isNewClient at component scope so it can drive both
  // the address-required warning (existing behaviour) AND the new
  // showDetails auto-expand (so the seller can fill phone for WhatsApp on
  // a fresh client). Computed from the typed name + loaded clients list,
  // identical semantics to the inline check that was previously inside
  // the address block's IIFE.
  const isNewClient = Boolean(form.clientName) && !clients.some((c) => c.name === form.clientName);

  // v1.2 UX-1: collapsible "تفاصيل إضافية" (phone, email, notes). One-way
  // auto-expand — opens when there's content to surface or the client is
  // new, never auto-closes during typing so the user doesn't lose their
  // input mid-edit. Manual toggle remains available either direction.
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    if (form.clientPhone || form.clientEmail || form.notes || isNewClient) {
      setShowDetails(true);
    }
  }, [form.clientPhone, form.clientEmail, form.notes, isNewClient]);

  // FEAT-04: reactive default for down_payment_expected.
  //
  // v1.0.3 Bug A hardening: cash/بنك sales now FORCE dpe = total
  // unconditionally — the touched flag no longer protects a manual edit
  // when the payment type is non-credit. Pre-v1.0.3, a seller could type
  // a partial dpe on a كاش sale, the touched flag would freeze it, and
  // the driver would later collect that partial amount. Live evidence:
  // sales.id=1 had كاش/950/500 from this exact flow. Now any change to
  // paymentType / quantity / unitPrice resets dpe to total for non-credit
  // and clears the touched flag, so the input stays in sync with the
  // computed total and the disabled UI control matches the server rule.
  useEffect(() => {
    if (form.paymentType !== 'آجل') {
      // Cash / bank: dpe is locked to total. Always overwrite + clear touched.
      const newDpe = total > 0 ? String(total) : '';
      setForm((prev) => (prev.downPaymentExpected === newDpe ? prev : { ...prev, downPaymentExpected: newDpe }));
      if (downPaymentTouched) setDownPaymentTouched(false);
      return;
    }
    // آجل: reactive default unless the user has manually edited.
    if (downPaymentTouched) return;
    setForm((prev) => ({ ...prev, downPaymentExpected: '' }));
  }, [form.paymentType, total, downPaymentTouched]);

  const dpeNum = parseFloat(form.downPaymentExpected) || 0;
  const dpeError = form.downPaymentExpected !== '' && (dpeNum < 0 || dpeNum > total + 0.005)
    ? `الدفعة المقدمة يجب أن تكون بين 0 و ${total}`
    : '';
  const remainingPreview = Math.max(0, total - dpeNum);

  // BUG-30: reactive price-floor check. Recomputes on every render from
  // form.item + form.unitPrice + products + role. Used to:
  //  (a) paint the sell-price input red
  //  (b) disable the submit button
  //  (c) show an inline error message below the input
  // Role-dependent message: admin/manager see the actual buy_price
  // (they have canSeeCosts anyway), sellers see vague language because
  // buy_price is a sensitive internal number per sales/page.js:229-232.
  const priceFloorError = (() => {
    if (!form.item || !form.unitPrice) return null;
    const p = products.find((pr) => pr.name === form.item);
    if (!p || !p.buy_price || p.buy_price <= 0) return null;
    const up = parseFloat(form.unitPrice);
    if (!up || up >= p.buy_price) return null;
    return canSeeCosts
      ? `سعر البيع (${up}€) أقل من سعر التكلفة (${p.buy_price}€). لا يمكن البيع بخسارة.`
      : 'سعر البيع المُدخَل غير مقبول. يرجى الالتزام بالسعر الموصى أو أعلى.';
  })();

  const fetchData = async () => {
    try {
      const fetches = [
        fetch('/api/sales', { cache: 'no-store' }),
        fetch('/api/clients', { cache: 'no-store' }),
        fetch('/api/products', { cache: 'no-store' }),
      ];
      if (isSeller) fetches.push(fetch('/api/settings', { cache: 'no-store' }));
      const results = await Promise.all(fetches);
      const salesData = await results[0].json();
      const clientsData = await results[1].json();
      const productsData = await results[2].json();
      setRows(Array.isArray(salesData) ? salesData : []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
      if (isSeller && results[3]) setBonusSettings(await results[3].json());
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  // Item 2 — filter pipeline. Client-side because row volumes are small
  // (Phase 0.5 production shows ~200 rows). Server-side can come later
  // if the list grows past ~500 rows.
  const filteredRows = rows.filter((r) => {
    if (filterDateFrom && r.date < filterDateFrom) return false;
    if (filterDateTo && r.date > filterDateTo) return false;
    if (filterClient && !r.client_name?.toLowerCase().includes(filterClient.toLowerCase())) return false;
    if (filterStatus !== 'all' && (r.status || 'محجوز') !== filterStatus) return false;
    if (filterPayStatus !== 'all' && r.payment_status !== filterPayStatus) return false;
    if (filterSeller !== 'all' && r.created_by !== filterSeller) return false;
    return true;
  });

  // Item 3 — click-to-sort, defaulting to newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    filteredRows,
    { key: 'date', direction: 'desc' }
  );

  const { paginatedRows, page, totalPages, perPage, setPerPage, goTo, totalRows: paginationTotal } = usePagination(sortedRows);

  // Seller list for the filter dropdown (derived from row data)
  const sellerOptions = Array.from(
    new Set(rows.map((r) => r.created_by).filter(Boolean))
  );

  const startEditSale = (row) => {
    setEditSale(row);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setDownPaymentTouched(true); // prevent reactive default from clobbering
    setForm({
      date: row.date || getTodayDate(),
      clientName: row.client_name || '',
      clientPhone: '',
      clientEmail: '',
      clientAddress: '',
      item: row.item || '',
      quantity: String(row.quantity ?? ''),
      unitPrice: String(row.unit_price ?? ''),
      paymentType: row.payment_type || 'كاش',
      downPaymentExpected: String(row.down_payment_expected ?? ''),
      notes: row.notes || '',
    });
    // Fill client details from the clients list
    const client = clients.find((c) => c.name === row.client_name);
    if (client) {
      setForm((prev) => ({
        ...prev,
        clientPhone: client.phone || '',
        clientEmail: client.email || '',
        clientAddress: client.address || '',
      }));
    }
  };

  const cancelEditSale = () => {
    setEditSale(null);
    setShowForm(false);
    setDownPaymentTouched(false);
    setForm({ date: getTodayDate(), clientName: '', clientPhone: '', clientEmail: '', clientAddress: '', item: '', quantity: '', unitPrice: '', paymentType: 'كاش', downPaymentExpected: '', notes: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.clientName || !form.item || !form.quantity || !form.unitPrice) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    // Seller cannot sell below recommended price (existing rule — unchanged)
    if (isSeller) {
      const prod = products.find((p) => p.name === form.item);
      if (prod?.sell_price && parseFloat(form.unitPrice) < prod.sell_price) {
        addToast(`لا يمكن البيع بأقل من السعر الموصى (${prod.sell_price})`, 'error');
        return;
      }
    }
    // BUG-30: all-roles buy_price floor. Fires after the seller check so a
    // seller hitting the recommended-price error gets that (more specific)
    // message first. For admin/manager, this is the only gate; the reactive
    // priceFloorError above disables the submit button so this branch is a
    // belt-and-suspenders guard for direct-submit paths.
    if (priceFloorError) {
      addToast(priceFloorError, 'error');
      return;
    }
    // FEAT-04: down payment validation (belt & suspenders — submit button
    // is already disabled when dpeError is set)
    if (dpeError) {
      addToast(dpeError, 'error');
      return;
    }
    setSubmitting(true);
    try {
      // --- EDIT mode: PUT existing sale ---
      if (editSale) {
        const res = await fetch('/api/sales', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editSale.id,
            clientName: form.clientName,
            item: form.item,
            quantity: form.quantity,
            unitPrice: form.unitPrice,
            notes: form.notes,
            downPaymentExpected: form.downPaymentExpected,
          }),
          cache: 'no-store',
        });
        if (res.ok) {
          addToast('تم تعديل الطلب بنجاح');
          cancelEditSale();
          fetchData();
        } else {
          const err = await res.json();
          addToast(err.error || 'خطأ في تعديل البيانات', 'error');
        }
        setSubmitting(false);
        return;
      }

      // --- ADD mode: POST new sale ---
      // Auto-create client if new
      const clientExists = clients.some((c) => c.name === form.clientName);
      if (!clientExists) {
        await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.clientName }),
          cache: 'no-store',
        });
      }

      // Auto-create product if new
      const productExists = products.some((p) => p.name === form.item);
      if (!productExists && form.item) {
        await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.item }),
          cache: 'no-store',
        });
      }

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        cache: 'no-store',
      });
      if (res.ok) {
        const result = await res.json();
        addToast('تم تسجيل عملية البيع وإنشاء توصيلة تلقائياً');

        // Ask if user wants to share via WhatsApp
        if (form.clientPhone) {
          const shareData = {
            phone: form.clientPhone.replace(/[^0-9+]/g, '').replace(/^00/, '').replace(/^\+/, ''),
            refCode: result.refCode || '',
            item: form.item,
            quantity: form.quantity,
            total,
            paymentMethod: form.paymentType,
            address: form.clientAddress,
          };
          setWhatsappShare(shareData);
        }

        setForm({ date: getTodayDate(), clientName: '', clientPhone: '', clientEmail: '', clientAddress: '', item: '', quantity: '', unitPrice: '', paymentType: 'كاش', downPaymentExpected: '', notes: '' });
        setDownPaymentTouched(false);
        setShowForm(false);
        fetchData();
      } else {
        const err = await res.json();
        addToast(err.error || 'خطأ في إضافة البيانات', 'error');
      }
    } catch (e) {
      addToast('خطأ في الاتصال: ' + (e.message || ''), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/sales?id=${deleteId}`, { method: 'DELETE', cache: 'no-store' });
      if (res.ok) {
        addToast('تم الحذف بنجاح');
        fetchData();
      } else {
        const data = await res.json();
        addToast(data.error || 'خطأ في الحذف', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    }
    setDeleteId(null);
  };

  return (
    <AppLayout>
      <div className="page-header">
        <h2>المبيعات</h2>
        <p>بيع الدراجات والإكسسوارات وقطع الغيار</p>
      </div>

      {/* Add Form — collapsible (PA-01) */}
      {!showForm ? (
        <div style={{ marginBottom: '24px' }}>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            إضافة عملية بيع جديدة
          </button>
        </div>
      ) : (
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          {editSale ? 'تعديل طلب' : 'تسجيل عملية بيع جديدة'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="sale-date">التاريخ *</label>
              <input id="sale-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>اسم العميل *</label>
              <SmartSelect
                value={form.clientName}
                onChange={(val, opt) => {
                  if (typeof opt === 'object' && opt.name) {
                    setForm((prev) => ({ ...prev, clientName: opt.name, clientPhone: opt.phone || prev.clientPhone, clientEmail: opt.email || prev.clientEmail, clientAddress: opt.address || prev.clientAddress }));
                  } else {
                    setForm((prev) => ({ ...prev, clientName: val }));
                  }
                }}
                options={clients.map((c) => ({ name: c.name, value: c.name, label: c.name, sub: c.phone || c.address || '', phone: c.phone, email: c.email, address: c.address }))}
                placeholder="Ahmad Ali"
                allowNew
                newLabel="عميل جديد"
                required
              />
              {/* BUG-5 hotfix: Latin-only hint for French invoice compliance.
                  Arabic input is still accepted — backend auto-transliterates. */}
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                ℹ️ اسم العميل بالأحرف اللاتينية (مثال: Ahmad, Samir)
              </div>
            </div>
            {/* v1.2 UX-1: phone + email moved into "تفاصيل إضافية" section
                below. They auto-expand into view when either has a value
                (e.g. SmartSelect filled them from an existing client) or
                when isNewClient is true (so the seller can add a phone
                for the WhatsApp post-sale prompt). */}
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              {/* BUG-6 hotfix 2026-04-14: delivery address is required when
                  the sale creates a new client. Existing clients inherit
                  their stored address. Amber border + warning only when
                  (new client AND empty address). */}
              {(() => {
                const addressMissing = isNewClient && !form.clientAddress?.trim();
                return (
                  <>
                    <label htmlFor="sale-address">
                      عنوان التوصيل {isNewClient && <span style={{ color: '#f59e0b' }}>*</span>}
                    </label>
                    <input
                      id="sale-address"
                      type="text"
                      value={form.clientAddress}
                      onChange={(e) => setForm({ ...form, clientAddress: e.target.value })}
                      placeholder="العنوان الكامل للتوصيل"
                      style={{
                        border: addressMissing ? '2px solid #f59e0b' : undefined,
                        background: addressMissing ? '#fffbeb' : undefined,
                      }}
                    />
                    {addressMissing && (
                      <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '4px' }}>
                        ⚠️ عميل جديد — العنوان مطلوب للتوصيل
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="form-group">
              <label htmlFor="sale-product">الصنف * (من المخزون)</label>
              <select
                id="sale-product"
                value={form.item}
                onChange={(e) => {
                  const p = products.find((pr) => pr.name === e.target.value);
                  setForm({ ...form, item: e.target.value, unitPrice: p?.sell_price || p?.buy_price || form.unitPrice });
                }}
                required
                style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.9rem', background: 'white' }}
              >
                <option value="">اختر صنف من المخزون</option>
                {/* DONE: Bug 3 — never expose buy_price (cost) in seller's product dropdown */}
                {products.filter((p) => p.stock > 0).map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}{p.description_ar ? ` — ${p.description_ar}` : ''} (متاح: {p.stock}{canSeeCosts ? ` | تكلفة: ${p.buy_price}` : ''})
                  </option>
                ))}
                {products.filter((p) => !p.stock || p.stock <= 0).length > 0 && (
                  <optgroup label="-- نفذ المخزون --">
                    {products.filter((p) => !p.stock || p.stock <= 0).map((p) => (
                      <option key={p.id} value={p.name} disabled style={{ color: '#999' }}>
                        {p.name}{p.description_ar ? ` — ${p.description_ar}` : ''} (نفذ)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sale-qty">الكمية * {form.item && products.find((p) => p.name === form.item) ? `(متاح: ${products.find((p) => p.name === form.item).stock})` : ''}</label>
              <input id="sale-qty" type="number" min="0" step="any" max={products.find((p) => p.name === form.item)?.stock || ''} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label htmlFor="sale-price">سعر البيع *</label>
              <input
                id="sale-price"
                type="number"
                min="0"
                step="any"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                placeholder="0"
                required
                style={priceFloorError ? { border: '2px solid #dc2626', background: '#fef2f2' } : undefined}
              />
              {/* BUG-30: inline error when unit_price < buy_price */}
              {priceFloorError && (
                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '4px' }}>
                  ⚠ {priceFloorError}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>الإجمالي</label>
              <input type="text" value={formatNumber(total)} readOnly />
            </div>
            {isSeller && form.item && form.unitPrice && (() => {
              const p = products.find((pr) => pr.name === form.item);
              const recommended = p?.sell_price || 0;
              const price = parseFloat(form.unitPrice) || 0;
              const qty = parseFloat(form.quantity) || 0;
              const fixedBonus = parseFloat(bonusSettings.seller_bonus_fixed) || 0;
              const pct = parseFloat(bonusSettings.seller_bonus_percentage) || 0;
              const extra = Math.max(0, price - recommended) * qty;
              const extraBonus = extra * pct / 100;
              const totalBonus = fixedBonus + extraBonus;
              return (
                <div className="form-group">
                  <label>العمولة المتوقعة (بعد التوصيل)</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '0.82rem', marginTop: '4px' }}>
                    <span style={{ background: '#dcfce7', padding: '4px 10px', borderRadius: '8px', color: '#16a34a' }}>
                      ثابت: {formatNumber(fixedBonus)}
                    </span>
                    {extraBonus > 0 && (
                      <span style={{ background: '#dbeafe', padding: '4px 10px', borderRadius: '8px', color: '#1e40af' }}>
                        إضافي ({pct}% من {formatNumber(extra)}): {formatNumber(extraBonus)}
                      </span>
                    )}
                    <span style={{ background: '#f0fdf4', padding: '6px 12px', borderRadius: '8px', color: '#15803d', fontWeight: 700, border: '1.5px solid #16a34a' }}>
                      المجموع: {formatNumber(totalBonus)}
                    </span>
                  </div>
                  {price < recommended && recommended > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#dc2626' }}>
                      السعر أقل من الموصى ({formatNumber(recommended)}) - لن يُقبل
                    </div>
                  )}
                </div>
              );
            })()}
            {form.item && canSeeCosts && (() => {
              const p = products.find((pr) => pr.name === form.item);
              const costPrice = p?.buy_price || 0;
              const qty = parseFloat(form.quantity) || 0;
              const costTotal = qty * costPrice;
              const saleProfit = total - costTotal;
              return (
                <div className="form-group">
                  <label>الربح المتوقع</label>
                  <div style={{ display: 'flex', gap: '8px', fontSize: '0.85rem', marginTop: '4px' }}>
                    <span style={{ background: '#fee2e2', padding: '4px 10px', borderRadius: '8px', color: '#dc2626' }}>
                      التكلفة: {formatNumber(costTotal)}
                    </span>
                    <span style={{ background: saleProfit >= 0 ? '#dcfce7' : '#fee2e2', padding: '4px 10px', borderRadius: '8px', color: saleProfit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                      الربح: {formatNumber(saleProfit)}
                    </span>
                  </div>
                </div>
              );
            })()}
            <div className="form-group">
              <label>طريقة الدفع *</label>
              <div className="radio-group" style={{ marginTop: '6px' }}>
                <label className="radio-option">
                  <input id="pay-cash" type="radio" name="payType" value="كاش" checked={form.paymentType === 'كاش'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  كاش (عند التوصيل)
                </label>
                <label className="radio-option">
                  <input id="pay-bank" type="radio" name="payType" value="بنك" checked={form.paymentType === 'بنك'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  بنك (تحويل)
                </label>
                <label className="radio-option">
                  <input id="pay-credit" type="radio" name="payType" value="آجل" checked={form.paymentType === 'آجل'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  آجل (دين)
                </label>
              </div>
              {form.paymentType === 'آجل' && (
                <div style={{ marginTop: '6px', padding: '8px 12px', background: '#fef3c7', borderRadius: '8px', fontSize: '0.8rem', color: '#92400e' }}>
                  سيُسجل كدين على العميل - يُدفع لاحقاً من صفحة تفاصيل العميل
                </div>
              )}
            </div>
            {/* FEAT-04: down_payment_expected.
                v1.0.3 Bug A: cash/bank sales force dpe = total (auto-synced
                in the useEffect above; do NOT touch that). v1.2 UX-1: when
                paymentType is cash/bank we hide the input entirely and
                show a one-line confirmation instead — the sync logic
                continues to set form.downPaymentExpected behind the
                scenes, so submit still receives the correct value. Only
                آجل (credit) sales render the editable DPE input. */}
            {form.paymentType === 'آجل' ? (
              <div className="form-group">
                <label htmlFor="sale-dpe">الدفعة المقدمة المتوقعة (€)</label>
                <input
                  id="sale-dpe"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.downPaymentExpected}
                  onChange={(e) => {
                    setDownPaymentTouched(true);
                    setForm({ ...form, downPaymentExpected: e.target.value });
                  }}
                  placeholder="0 (اختياري — لفرض دفعة مقدمة على الدين)"
                  style={{
                    border: dpeError ? '2px solid #dc2626' : '1.5px solid #d1d5db',
                    background: dpeError ? '#fef2f2' : undefined,
                  }}
                />
                <div style={{ fontSize: '0.75rem', color: dpeError ? '#dc2626' : '#64748b', marginTop: '4px' }}>
                  {dpeError || (total > 0 ? `المتبقي بعد التوصيل: ${formatNumber(remainingPreview)}` : 'أدخل الكمية والسعر لرؤية المتبقي')}
                </div>
              </div>
            ) : (
              total > 0 && (
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <div style={{
                    padding: '10px 14px',
                    background: '#dcfce7',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: '#166534',
                    fontWeight: 600,
                  }}>
                    ✓ سيتم تحصيل كامل المبلغ ({formatNumber(total)} €) عند التوصيل
                  </div>
                </div>
              )
            )}

            {/* v1.2 UX-1: collapsible details section. Phone is critical
                for the WhatsApp post-sale prompt in handleSubmit (line ~320),
                so the auto-expand effect above opens this section whenever
                phone/email/notes have values OR the client is new. Manual
                toggle stays available; auto-expand is one-way (never
                auto-collapses while the user is typing). */}
            <div className="form-group" style={{ gridColumn: 'span 2', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                style={{
                  background: 'transparent',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '8px',
                  color: '#475569',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '8px 12px',
                  width: '100%',
                  textAlign: 'right',
                  fontFamily: "'Cairo', sans-serif",
                }}
                aria-expanded={showDetails}
              >
                {showDetails ? '▲' : '▼'} تفاصيل إضافية (هاتف للواتساب، إيميل، ملاحظات)
              </button>
            </div>
            {showDetails && (
              <>
                <div className="form-group">
                  <label htmlFor="sale-phone">هاتف العميل (للمشاركة عبر WhatsApp بعد البيع)</label>
                  <input id="sale-phone" type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="06 12 34 56 78" style={{ direction: 'ltr', textAlign: 'right' }} />
                </div>
                <div className="form-group">
                  <label htmlFor="sale-email">إيميل العميل</label>
                  <input id="sale-email" type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} placeholder="email@example.com" style={{ direction: 'ltr', textAlign: 'right' }} />
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="sale-notes">ملاحظات</label>
                  <input id="sale-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !!priceFloorError}
            >
              {submitting ? (editSale ? 'جاري التعديل...' : 'جاري التسجيل...') : (editSale ? 'حفظ التعديلات' : 'تسجيل عملية بيع')}
            </button>
            {editSale && (
              <button type="button" className="btn btn-outline" onClick={cancelEditSale}>
                إلغاء التعديل
              </button>
            )}
          </div>
        </form>
      </div>
      )}

      {/* Data Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المبيعات ({sortedRows.length}/{rows.length})
          </h3>
        </div>

        {/* Item 2 — filter bar */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.85rem' }}>
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} title="من تاريخ" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} title="إلى تاريخ" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
          <input type="text" placeholder="بحث عميل..." value={filterClient} onChange={(e) => setFilterClient(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }}>
            <option value="all">كل الحالات</option>
            <option value="محجوز">محجوز</option>
            <option value="مؤكد">مؤكد</option>
            <option value="ملغي">ملغي</option>
          </select>
          <select value={filterPayStatus} onChange={(e) => setFilterPayStatus(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }}>
            <option value="all">كل حالات الدفع</option>
            <option value="pending">معلق</option>
            <option value="partial">جزئي</option>
            <option value="paid">مدفوع</option>
            <option value="cancelled">ملغي</option>
          </select>
          {canSeeCosts && (
            <select value={filterSeller} onChange={(e) => setFilterSeller(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px' }}>
              <option value="all">كل البائعين</option>
              {sellerOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {(filterDateFrom || filterDateTo || filterClient || filterStatus !== 'all' || filterPayStatus !== 'all' || filterSeller !== 'all') && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterClient(''); setFilterStatus('all'); setFilterPayStatus('all'); setFilterSeller('all'); }}
            >
              ✕ مسح
            </button>
          )}
        </div>

        {loading ? (
          <PageSkeleton rows={8} />
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <h3>{rows.length === 0 ? 'لا توجد مبيعات بعد' : 'لا توجد نتائج'}</h3>
            <p>{rows.length === 0 ? 'سجّل أول عملية بيع من النموذج أعلاه' : 'جرّب تعديل الفلاتر'}</p>
          </div>
        ) : (
          <>
          {/* v1.1 S3.2 — mobile card fallback: visible below 768px, hidden at 768px+ */}
          <DataCardList
            rows={paginatedRows}
            fields={[
              { key: 'ref_code', label: 'الكود' },
              { key: 'date', label: 'التاريخ' },
              { key: 'client_name', label: 'العميل' },
              { key: 'item', label: 'المنتج' },
              { key: 'quantity', label: 'الكمية' },
              { key: 'total', label: 'المبلغ', format: (v) => v ? `${formatNumber(v)} €` : '—' },
              { key: 'paid_amount', label: 'المدفوع', format: (v) => v ? `${formatNumber(v)} €` : '—' },
              { key: 'remaining', label: 'المتبقي', format: (v) => v ? `${formatNumber(v)} €` : '—' },
              { key: 'payment_type', label: 'الدفع' },
            ]}
            statusField="status"
            statusColors={{
              'مؤكد': '#16a34a',
              'محجوز': '#f59e0b',
              'ملغي': '#dc2626',
            }}
            actions={(row) => (
              <>
                {/* v1.2 — mobile card parity with desktop table actions.
                    Pre-v1.2 only the "تفاصيل" button was on mobile, leaving
                    WhatsApp share, edit, and cancel/delete all desktop-
                    exclusive. Same permission gates as desktop. */}
                <button className="btn btn-primary btn-sm" onClick={() => setSelectedRow(row)}>تفاصيل</button>
                <button
                  className="btn btn-sm"
                  style={{ background: '#25d366', color: 'white' }}
                  onClick={() => {
                    const client = clients.find((c) => c.name === row.client_name);
                    const phone = (client?.phone || '').replace(/[^0-9+]/g, '').replace(/^00/, '').replace(/^\+/, '');
                    if (!phone) { addToast('لا يوجد رقم هاتف للعميل', 'error'); return; }
                    const msg = encodeURIComponent(
`*Vitesse Eco*
*الكود:* ${row.ref_code || row.id}
*المنتج:* ${row.item}
*الكمية:* ${row.quantity}
*المبلغ:* ${row.total}
*الحالة:* ${row.status || 'محجوز'}`
                    );
                    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
                  }}
                  title="مشاركة عبر واتساب"
                >
                  واتساب
                </button>
                {(row.status || 'محجوز') !== 'ملغي' && (
                  isAdmin || ((!isAdmin) && (role === 'seller' || role === 'manager') && (row.status || 'محجوز') === 'محجوز')
                ) && (
                  <button className="btn btn-outline btn-sm" onClick={() => startEditSale(row)}>
                    تعديل
                  </button>
                )}
                {canCancelSale(row, currentUser) && isAdmin && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setCancelSale({ saleId: row.id, invoiceMode: 'delete' })}
                  >
                    حذف
                  </button>
                )}
                {canCancelSale(row, currentUser) && !isAdmin && (
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>
                    حذف
                  </button>
                )}
              </>
            )}
            emptyMessage="لا توجد مبيعات"
          />
          <div className="table-container has-card-fallback">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('ref_code')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('ref_code')}>الكود{getSortIndicator('ref_code')}</th>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('date')}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('client_name')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('client_name')}>العميل{getSortIndicator('client_name')}</th>
                  <th onClick={() => requestSort('item')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('item')}>الصنف{getSortIndicator('item')}</th>
                  <th onClick={() => requestSort('quantity')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('quantity')}>الكمية{getSortIndicator('quantity')}</th>
                  <th onClick={() => requestSort('unit_price')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('unit_price')}>سعر الوحدة{getSortIndicator('unit_price')}</th>
                  <th onClick={() => requestSort('total')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('total')}>الإجمالي{getSortIndicator('total')}</th>
                  <th onClick={() => requestSort('paid_amount')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('paid_amount')}>المدفوع{getSortIndicator('paid_amount')}</th>
                  <th onClick={() => requestSort('remaining')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('remaining')}>المتبقي{getSortIndicator('remaining')}</th>
                  {canSeeCosts && <th onClick={() => requestSort('cost_total')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('cost_total')}>التكلفة{getSortIndicator('cost_total')}</th>}
                  {canSeeCosts && <th onClick={() => requestSort('profit')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('profit')}>الربح{getSortIndicator('profit')}</th>}
                  <th onClick={() => requestSort('status')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('status')}>الحالة{getSortIndicator('status')}</th>
                  <th onClick={() => requestSort('payment_type')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('payment_type')}>الدفع{getSortIndicator('payment_type')}</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.ref_code || `SL-${row.id}`}</td>
                    <td>{row.date}</td>
                    <td>{row.client_name}</td>
                    <td>{row.item}</td>
                    <td className="number-cell">{formatNumber(row.quantity)}</td>
                    <td className="number-cell">{formatNumber(row.unit_price)}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.total)}</td>
                    <td className="number-cell">{formatNumber(row.paid_amount)}</td>
                    <td className="number-cell" style={{ color: (row.remaining || 0) > 0 ? '#dc2626' : undefined }}>{formatNumber(row.remaining)}</td>
                    {canSeeCosts && <td className="number-cell" style={{ color: '#94a3b8' }}>{formatNumber(row.cost_total)}</td>}
                    {canSeeCosts && <td className="number-cell" style={{ color: (row.profit || 0) >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                      {formatNumber(row.profit)}
                    </td>}
                    <td>
                      <span className="status-badge" style={{
                        background: row.status === 'مؤكد' ? '#dcfce7' : row.status === 'ملغي' ? '#fee2e2' : '#fef3c7',
                        color: row.status === 'مؤكد' ? '#16a34a' : row.status === 'ملغي' ? '#dc2626' : '#d97706',
                      }}>
                        {row.status || 'محجوز'}
                      </span>
                    </td>
                    <td>
                      <span className="status-badge" style={{
                        background: row.payment_type === 'بنك' ? '#dbeafe' : row.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7',
                        color: row.payment_type === 'بنك' ? '#1e40af' : row.payment_type === 'آجل' ? '#d97706' : '#16a34a'
                      }}>
                        {row.payment_type || 'كاش'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#25d366', color: 'white', padding: '4px 8px' }}
                          onClick={() => {
                            const client = clients.find((c) => c.name === row.client_name);
                            const phone = (client?.phone || '').replace(/[^0-9+]/g, '').replace(/^00/, '').replace(/^\+/, '');
                            if (!phone) { addToast('لا يوجد رقم هاتف للعميل', 'error'); return; }
                            const msg = encodeURIComponent(
`*Vitesse Eco*
*الكود:* ${row.ref_code || row.id}
*المنتج:* ${row.item}
*الكمية:* ${row.quantity}
*المبلغ:* ${row.total}
*الحالة:* ${row.status || 'محجوز'}`
                            );
                            window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
                          }}
                          title="مشاركة عبر واتساب"
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.252-.149-2.737.813.813-2.737-.149-.252A8 8 0 1112 20z"/></svg>
                        </button>
                        {/* Edit button: admin can edit all non-cancelled; seller/manager only reserved */}
                        {(row.status || 'محجوز') !== 'ملغي' && (
                          isAdmin || ((!isAdmin) && (role === 'seller' || role === 'manager') && (row.status || 'محجوز') === 'محجوز')
                        ) && (
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); startEditSale(row); }}>
                            تعديل
                          </button>
                        )}
                        {/* v1 pre-delivery — locked cancel rule wired via canCancelSale.
                            Admin gets the full CancelSaleDialog (can cancel reserved + confirmed,
                            handles bonuses/refunds). Manager + seller reach this branch only for
                            reserved sales and use the simple DELETE path (no bonuses/payments on
                            reserved). Driver never sees a cancel button. */}
                        {canCancelSale(row, currentUser) && isAdmin && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setCancelSale({ saleId: row.id, invoiceMode: 'delete' })}
                          >
                            حذف
                          </button>
                        )}
                        {canCancelSale(row, currentUser) && !isAdmin && (
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalRows={paginationTotal}
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
        title={selectedRow ? `بيع ${selectedRow.ref_code || selectedRow.id}` : ''}
        fields={selectedRow ? [
          { label: 'الكود', value: selectedRow.ref_code || `SL-${selectedRow.id}`, color: '#6366f1' },
          { label: 'التاريخ', value: selectedRow.date },
          { label: 'العميل', value: selectedRow.client_name },
          { type: 'divider' },
          { label: 'المنتج', value: selectedRow.item },
          { label: 'الكمية', value: selectedRow.quantity },
          { label: 'سعر الوحدة', type: 'money', value: selectedRow.unit_price },
          { label: 'الإجمالي', type: 'money', value: selectedRow.total },
          ...(canSeeCosts ? [
            { type: 'divider' },
            { label: 'التكلفة', type: 'money', value: selectedRow.cost_total, color: '#94a3b8' },
            { label: 'الربح', type: 'money', value: selectedRow.profit, color: (selectedRow.profit || 0) >= 0 ? '#16a34a' : '#dc2626' },
          ] : []),
          { type: 'divider' },
          { label: 'حالة الطلب', type: 'badge', value: selectedRow.status || 'محجوز', bg: selectedRow.status === 'مؤكد' ? '#dcfce7' : selectedRow.status === 'ملغي' ? '#fee2e2' : '#fef3c7', color: selectedRow.status === 'مؤكد' ? '#16a34a' : selectedRow.status === 'ملغي' ? '#dc2626' : '#d97706' },
          { label: 'طريقة الدفع', type: 'badge', value: selectedRow.payment_type || 'كاش', bg: selectedRow.payment_type === 'بنك' ? '#dbeafe' : selectedRow.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7', color: selectedRow.payment_type === 'بنك' ? '#1e40af' : selectedRow.payment_type === 'آجل' ? '#d97706' : '#16a34a' },
          ...(selectedRow.created_by ? [{ label: 'بواسطة', value: selectedRow.created_by }] : []),
          ...(selectedRow.notes ? [{ label: 'ملاحظات', value: selectedRow.notes }] : []),
        ] : []}
      />

      {/* WhatsApp Share Modal */}
      {whatsappShare && (
        <div className="modal-overlay" onClick={() => setWhatsappShare(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#25d366', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.252-.149-2.737.813.813-2.737-.149-.252A8 8 0 1112 20z"/></svg>
            </div>
            <h3>تم تسجيل البيع بنجاح!</h3>
            <p>هل تريد مشاركة تفاصيل الطلب مع العميل عبر واتساب؟</p>
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px', margin: '16px 0', textAlign: 'right', fontSize: '0.85rem', lineHeight: 1.8 }}>
              <div><strong>الكود:</strong> {whatsappShare.refCode}</div>
              <div><strong>المنتج:</strong> {whatsappShare.item}</div>
              <div><strong>الكمية:</strong> {whatsappShare.quantity}</div>
              <div><strong>المبلغ:</strong> {formatNumber(whatsappShare.total)}</div>
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                style={{ background: '#25d366', color: 'white', flex: 1 }}
                onClick={() => {
                  const s = whatsappShare;
                  const msg = encodeURIComponent(
`*Vitesse Eco - تأكيد طلب*
━━━━━━━━━━━━━━━━━
*الكود:* ${s.refCode}
*المنتج:* ${s.item}
*الكمية:* ${s.quantity}
*المبلغ:* ${s.total}
*الدفع:* ${s.paymentMethod === 'كاش' || s.paymentMethod === 'بنك' ? 'مدفوع' : 'آجل'}
━━━━━━━━━━━━━━━━━
*التوصيل إلى:* ${s.address || '-'}

شكراً لتعاملكم معنا!`
                  );
                  window.open(`https://wa.me/${s.phone}?text=${msg}`, '_blank');
                  setWhatsappShare(null);
                }}
              >
                إرسال عبر واتساب
              </button>
              <button className="btn btn-outline" onClick={() => setWhatsappShare(null)}>
                لا، شكراً
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف عملية بيع"
        message="هل أنت متأكد من حذف هذه العملية؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* FEAT-05: cancellation dialog for admin-initiated sale deletion.
          The dialog runs in invoiceMode='delete' which hides the "keep"
          option for bonuses and forces 'remove' (FK cascade rule). The
          actual DELETE of the sale row happens inside cancelSale's
          deleteSale wrapper. */}
      <div className="cross-nav"><Link href="/clients">العملاء &rarr;</Link><Link href="/deliveries">التوصيل &rarr;</Link><Link href="/invoices">الفواتير &rarr;</Link></div>

      {cancelSale && (
        <CancelSaleDialog
          saleId={cancelSale.saleId}
          invoiceMode={cancelSale.invoiceMode || 'delete'}
          title="إلغاء عملية البيع"
          onSuccess={() => {
            setCancelSale(null);
            addToast('تم إلغاء عملية البيع بنجاح');
            fetchData();
          }}
          onCancel={() => setCancelSale(null)}
        />
      )}
    </AppLayout>
  );
}

export default function SalesPage() {
  return (
    <Suspense>
    <ToastProvider>
      <SalesContent />
    </ToastProvider>
    </Suspense>
  );
}
