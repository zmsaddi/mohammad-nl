'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { formatNumber, getTodayDate, PRODUCT_CATEGORIES } from '@/lib/utils';
import DetailModal from '@/components/DetailModal';
import SmartSelect from '@/components/SmartSelect';
import { useSortedRows } from '@/lib/use-sorted-rows';

function PurchasesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  const [form, setForm] = useState({
    date: getTodayDate(),
    supplier: '',
    item: '',
    category: '', // DONE: Step 3 — required category for new purchases
    quantity: '',
    unitPrice: '',
    sellPrice: '',
    paymentType: 'كاش',
    notes: '',
    // v1.0.1 Feature 6 — supplier credit. Empty string = "pay in full"
    // (default = total). Any other value goes through as the initial
    // down payment, with payment_status derived from the ratio.
    paidAmount: '',
  });

  // v1.0.1 Feature 6 — pay-supplier dialog state. Opens when user clicks
  // "💰 دفع" on a partial/pending purchase.
  const [paySupplierState, setPaySupplierState] = useState(null);
  // { purchaseId, total, currentPaid, amount, paymentMethod, notes, submitting }

  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitPrice) || 0);

  // BUG-31 (purchases mirror): inline sell_price < unit_price guard. The
  // server-side check already exists in addPurchase (BUG-30), but without
  // a reactive UI error the user only discovers the problem on submit.
  // Mirrors the app/sales/page.js:89-98 priceFloorError pattern exactly.
  const sellPriceError = (() => {
    const up = parseFloat(form.unitPrice);
    const sp = parseFloat(form.sellPrice);
    if (!up || !sp || up <= 0 || sp <= 0) return null;
    if (sp >= up) return null;
    return `سعر البيع الموصى (${sp}€) لا يمكن أن يكون أقل من سعر الشراء (${up}€).`;
  })();

  const fetchData = async () => {
    try {
      const [purchasesRes, productsRes, suppliersRes] = await Promise.all([
        fetch('/api/purchases', { cache: 'no-store' }),
        fetch('/api/products', { cache: 'no-store' }),
        fetch('/api/suppliers', { cache: 'no-store' }),
      ]);
      const purchasesData = await purchasesRes.json();
      const productsData = await productsRes.json();
      const suppliersData = await suppliersRes.json();
      setRows(Array.isArray(purchasesData) ? purchasesData.reverse() : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  // Item 3 — click-to-sort, default newest first
  const { sortedRows, requestSort, getSortIndicator, getAriaSort } = useSortedRows(
    rows,
    { key: 'date', direction: 'desc' }
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.supplier || !form.item || !form.quantity || !form.unitPrice) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    // DONE: Step 3F — category required so the inventory taxonomy stays clean
    if (!form.category) {
      addToast('يرجى اختيار فئة المنتج', 'error');
      return;
    }
    // BUG-31: belt-and-suspenders gate when user bypasses the disabled
    // submit button (e.g. keyboard Enter on a touched form).
    if (sellPriceError) {
      addToast(sellPriceError, 'error');
      return;
    }
    setSubmitting(true);
    try {
      // Auto-create product if new — DONE: Step 3E pass category through
      const productExists = products.some((p) => p.name === form.item);
      if (!productExists && form.item) {
        await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.item, category: form.category }),
          cache: 'no-store',
        });
      }

      // Auto-create supplier if new.
      // BUG-21: addSupplier now returns { ambiguous, candidates, message }
      // when the name already exists with no phone disambiguator. Same
      // pattern as addClient → surface the toast and abort so the user
      // can add a phone number and retry. `return` aborts the whole
      // purchase submit — the user must resolve the ambiguity before
      // their purchase can land (otherwise the DB row would point at
      // a wrong existing supplier).
      const supplierExists = suppliers.some((s) => s.name === form.supplier);
      if (!supplierExists && form.supplier) {
        const supRes = await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.supplier }),
          cache: 'no-store',
        });
        const supData = await supRes.json().catch(() => ({}));
        if (supData?.ambiguous) {
          addToast(supData.message || 'يوجد مورد بنفس الاسم — أضف رقم هاتف للتمييز', 'error');
          // BUG-4 cleanup 2026-04-14: removed redundant manual
          // setSubmitting(false) here — the outer finally block already
          // handles it. Keeping the return so the rest of the purchase
          // flow is skipped.
          return;
        }
      }

      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        cache: 'no-store',
      });
      if (res.ok) {
        addToast('تم إضافة عملية الشراء بنجاح');
        setForm({ date: getTodayDate(), supplier: '', item: '', category: '', quantity: '', unitPrice: '', sellPrice: '', paymentType: 'كاش', notes: '', paidAmount: '' });
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
      const res = await fetch(`/api/purchases?id=${deleteId}`, { method: 'DELETE', cache: 'no-store' });
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
        <h2>المشتريات</h2>
        <p>شراء الدراجات والإكسسوارات وقطع الغيار</p>
      </div>

      {/* Add Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          إضافة عملية شراء جديدة
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="pur-date">التاريخ *</label>
              <input id="pur-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>المورد *</label>
              <SmartSelect
                value={form.supplier}
                onChange={(val) => setForm({ ...form, supplier: val })}
                options={suppliers.map((s) => ({ name: s.name, value: s.name, label: s.name }))}
                placeholder="Wahid Trading"
                allowNew
                newLabel="مورد جديد"
                required
              />
              {/* BUG-5 hotfix: Latin-only hint for French invoice compliance.
                  Arabic input is still accepted — the backend auto-transliterates. */}
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                ℹ️ اسم المورد يجب أن يكون بالأحرف اللاتينية للفواتير
              </div>
            </div>
            <div className="form-group">
              <label>المنتج *</label>
              <SmartSelect
                value={form.item}
                onChange={(val) => {
                  // DONE: Step 3 — auto-fill category from existing product when picked
                  const existing = products.find((p) => p.name === val);
                  setForm({ ...form, item: val, category: existing?.category || form.category });
                }}
                options={products.map((p) => ({ name: p.name, value: p.name, label: p.name, sub: `مخزون: ${p.stock || 0}` }))}
                placeholder="اكتب اسم المنتج..."
                allowNew
                newLabel="منتج جديد"
                required
              />
            </div>
            {/* DONE: Step 3C — category select right after the product field */}
            <div className="form-group">
              <label htmlFor="pur-category">فئة المنتج *</label>
              <select
                id="pur-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
                style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.9rem', background: 'white' }}
              >
                <option value="">اختر فئة...</option>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pur-qty">الكمية *</label>
              <input id="pur-qty" type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label htmlFor="pur-price">سعر الوحدة *</label>
              <input id="pur-price" type="number" min="0" step="any" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label htmlFor="pur-sell-price">سعر البيع الموصى *</label>
              <input
                id="pur-sell-price"
                type="number"
                min="0"
                step="any"
                value={form.sellPrice}
                onChange={(e) => setForm({ ...form, sellPrice: e.target.value })}
                placeholder="سعر البيع للعميل"
                required
                style={{
                  border: sellPriceError ? '2px solid #dc2626' : undefined,
                  background: sellPriceError ? '#fef2f2' : undefined,
                }}
              />
              {/* BUG-31: inline error when sell_price < unit_price (mirror BUG-30 pattern) */}
              {sellPriceError && (
                <div style={{ marginTop: '6px', color: '#dc2626', fontSize: '0.78rem' }}>
                  {sellPriceError}
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="pur-total">الإجمالي</label>
              <input id="pur-total" type="text" value={formatNumber(total)} readOnly />
            </div>
            <div className="form-group">
              <label>طريقة الدفع</label>
              <div className="radio-group" style={{ marginTop: '6px' }}>
                <label className="radio-option">
                  <input id="pur-pay-cash" type="radio" name="purchasePayType" value="كاش" checked={form.paymentType === 'كاش'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  كاش
                </label>
                <label className="radio-option">
                  <input id="pur-pay-bank" type="radio" name="purchasePayType" value="بنك" checked={form.paymentType === 'بنك'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  بنك
                </label>
              </div>
            </div>
            {/* v1.0.1 Feature 6 — supplier credit: paid_amount on the
                purchase form. Blank defaults to "pay in full now"
                (backward compat). Any value ≥ 0 and ≤ total creates a
                partial/pending purchase. */}
            <div className="form-group">
              <label htmlFor="pur-paid">المدفوع الآن (اختياري)</label>
              <input
                id="pur-paid"
                type="number"
                min="0"
                step="any"
                value={form.paidAmount}
                onChange={(e) => setForm({ ...form, paidAmount: e.target.value })}
                placeholder={`الافتراضي: ${formatNumber(total)}`}
                style={{
                  border: (parseFloat(form.paidAmount) || 0) > total + 0.01
                    ? '2px solid #dc2626'
                    : undefined,
                }}
              />
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                اتركه فارغاً للدفع بالكامل. للشراء بالدين، أدخل المبلغ المدفوع الآن والباقي يُسجّل لاحقاً.
                {form.paidAmount !== '' && total > 0 && (
                  <>
                    {' '}المتبقي: <strong style={{ color: '#dc2626' }}>{formatNumber(Math.max(0, total - (parseFloat(form.paidAmount) || 0)))}</strong>
                  </>
                )}
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="pur-notes">ملاحظات</label>
              <input id="pur-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting || !!sellPriceError}>
            {submitting ? 'جاري الإضافة...' : 'إضافة عملية شراء'}
          </button>
        </form>
      </div>

      {/* Data Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المشتريات ({rows.length})
          </h3>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد مشتريات بعد</h3>
            <p>أضف أول عملية شراء من النموذج أعلاه</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort('ref_code')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('ref_code')}>الكود{getSortIndicator('ref_code')}</th>
                  <th onClick={() => requestSort('date')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('date')}>التاريخ{getSortIndicator('date')}</th>
                  <th onClick={() => requestSort('supplier')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('supplier')}>المورد{getSortIndicator('supplier')}</th>
                  <th onClick={() => requestSort('item')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('item')}>المنتج{getSortIndicator('item')}</th>
                  <th onClick={() => requestSort('category')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('category')}>الفئة{getSortIndicator('category')}</th>
                  <th onClick={() => requestSort('quantity')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('quantity')}>الكمية{getSortIndicator('quantity')}</th>
                  <th onClick={() => requestSort('unit_price')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('unit_price')}>سعر الوحدة{getSortIndicator('unit_price')}</th>
                  <th onClick={() => requestSort('total')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('total')}>الإجمالي{getSortIndicator('total')}</th>
                  {/* v1.0.1 Feature 6 — supplier credit columns */}
                  <th onClick={() => requestSort('paid_amount')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('paid_amount')}>المدفوع{getSortIndicator('paid_amount')}</th>
                  <th onClick={() => requestSort('payment_status')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('payment_status')}>الحالة{getSortIndicator('payment_status')}</th>
                  <th onClick={() => requestSort('payment_type')} style={{ cursor: 'pointer' }} aria-sort={getAriaSort('payment_type')}>طريقة الدفع{getSortIndicator('payment_type')}</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.ref_code || `PU-${row.id}`}</td>
                    <td>{row.date}</td>
                    <td>{row.supplier}</td>
                    <td>{row.item}</td>
                    {/* DONE: Step 6 — category cell (legacy rows show '-') */}
                    <td>
                      <span style={{
                        fontSize: '0.75rem',
                        background: '#f1f5f9',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        color: '#475569',
                      }}>
                        {row.category || '-'}
                      </span>
                    </td>
                    <td className="number-cell">{formatNumber(row.quantity)}</td>
                    <td className="number-cell">{formatNumber(row.unit_price)}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.total)}</td>
                    {/* v1.0.1 Feature 6 — paid + status cells */}
                    <td className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>
                      {formatNumber(row.paid_amount ?? row.total)}
                    </td>
                    <td>
                      {(() => {
                        const status = row.payment_status || 'paid';
                        const style = status === 'paid'
                          ? { bg: '#dcfce7', fg: '#166534', label: 'مدفوع' }
                          : status === 'partial'
                          ? { bg: '#ffedd5', fg: '#9a3412', label: 'جزئي' }
                          : { bg: '#fef3c7', fg: '#92400e', label: 'معلق' };
                        return (
                          <span className="status-badge" style={{ background: style.bg, color: style.fg }}>
                            {style.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td><span className="status-badge" style={{ background: row.payment_type === 'بنك' ? '#dbeafe' : '#dcfce7', color: row.payment_type === 'بنك' ? '#1e40af' : '#16a34a' }}>{row.payment_type || 'كاش'}</span></td>
                    <td>{row.notes}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                        {/* v1.0.1 Feature 6 — "pay now" button for partial/pending */}
                        {row.payment_status && row.payment_status !== 'paid' && (
                          <button
                            className="btn btn-sm"
                            style={{ background: '#16a34a', color: 'white', padding: '4px 8px' }}
                            onClick={() => setPaySupplierState({
                              purchaseId: row.id,
                              supplier: row.supplier,
                              total: parseFloat(row.total) || 0,
                              currentPaid: parseFloat(row.paid_amount) || 0,
                              amount: '',
                              paymentMethod: 'كاش',
                              notes: '',
                              submitting: false,
                            })}
                          >
                            💰 دفع
                          </button>
                        )}
                        {isAdmin && (
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
        )}
      </div>

      <DetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `شراء ${selectedRow.ref_code || selectedRow.id}` : ''}
        fields={selectedRow ? [
          { label: 'الكود', value: selectedRow.ref_code || `PU-${selectedRow.id}`, color: '#6366f1' },
          { label: 'التاريخ', value: selectedRow.date },
          { label: 'المورد', value: selectedRow.supplier },
          { type: 'divider' },
          { label: 'المنتج', value: selectedRow.item },
          { label: 'الكمية', value: selectedRow.quantity },
          { label: 'سعر الوحدة', type: 'money', value: selectedRow.unit_price },
          { label: 'الإجمالي', type: 'money', value: selectedRow.total },
          { type: 'divider' },
          { label: 'وسيلة الدفع', type: 'badge', value: selectedRow.payment_type || 'كاش', bg: selectedRow.payment_type === 'بنك' ? '#dbeafe' : '#dcfce7', color: selectedRow.payment_type === 'بنك' ? '#1e40af' : '#16a34a' },
          ...(selectedRow.created_by ? [{ label: 'بواسطة', value: selectedRow.created_by }] : []),
          ...(selectedRow.notes ? [{ label: 'ملاحظات', value: selectedRow.notes }] : []),
        ] : []}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف عملية شراء"
        message="هل أنت متأكد من حذف هذه العملية؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* v1.0.1 Feature 6 — pay-supplier dialog */}
      {paySupplierState && (() => {
        const s = paySupplierState;
        const remaining = Math.max(0, s.total - s.currentPaid);
        const amt = parseFloat(s.amount) || 0;
        const exceeds = amt > remaining + 0.01;
        const canSubmit = amt > 0 && !exceeds && !s.submitting;
        const handlePay = async () => {
          setPaySupplierState({ ...s, submitting: true });
          try {
            const res = await fetch(`/api/purchases/${s.purchaseId}/pay`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: amt,
                paymentMethod: s.paymentMethod,
                notes: s.notes,
              }),
              cache: 'no-store',
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              addToast('تم تسجيل الدفعة بنجاح');
              setPaySupplierState(null);
              fetchData();
            } else {
              addToast(data.error || 'خطأ في تسجيل الدفعة', 'error');
              setPaySupplierState({ ...s, submitting: false });
            }
          } catch {
            addToast('خطأ في الاتصال', 'error');
            setPaySupplierState({ ...s, submitting: false });
          }
        };
        return (
          <div
            onClick={() => setPaySupplierState(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1000, padding: '20px',
            }}
          >
            <div
              className="card"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '440px', width: '100%' }}
            >
              <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>دفع للمورد — {s.supplier}</h3>
              <div style={{ background: '#f9fafb', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.85rem' }}>
                <div>الإجمالي: <strong>{formatNumber(s.total)}€</strong></div>
                <div>مدفوع سابقاً: <strong style={{ color: '#16a34a' }}>{formatNumber(s.currentPaid)}€</strong></div>
                <div>المتبقي: <strong style={{ color: '#dc2626' }}>{formatNumber(remaining)}€</strong></div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>المبلغ *</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={s.amount}
                  onChange={(e) => setPaySupplierState({ ...s, amount: e.target.value })}
                  placeholder={formatNumber(remaining)}
                  style={{
                    border: exceeds ? '2px solid #dc2626' : undefined,
                  }}
                />
                {exceeds && (
                  <div style={{ marginTop: '4px', color: '#dc2626', fontSize: '0.78rem' }}>
                    المبلغ يتجاوز المتبقي
                  </div>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>وسيلة الدفع</label>
                <div className="radio-group" style={{ marginTop: '6px' }}>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="supplier-pay-method"
                      value="كاش"
                      checked={s.paymentMethod === 'كاش'}
                      onChange={(e) => setPaySupplierState({ ...s, paymentMethod: e.target.value })}
                    />
                    كاش
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="supplier-pay-method"
                      value="بنك"
                      checked={s.paymentMethod === 'بنك'}
                      onChange={(e) => setPaySupplierState({ ...s, paymentMethod: e.target.value })}
                    />
                    بنك
                  </label>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>ملاحظات</label>
                <input
                  type="text"
                  value={s.notes}
                  onChange={(e) => setPaySupplierState({ ...s, notes: e.target.value })}
                  placeholder="ملاحظات اختيارية"
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-outline"
                  onClick={() => setPaySupplierState(null)}
                >
                  إلغاء
                </button>
                <button
                  className="btn btn-success"
                  disabled={!canSubmit}
                  onClick={handlePay}
                >
                  {s.submitting ? 'جاري التسجيل...' : 'تأكيد الدفع'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </AppLayout>
  );
}

export default function PurchasesPage() {
  return (
    <ToastProvider>
      <PurchasesContent />
    </ToastProvider>
  );
}
