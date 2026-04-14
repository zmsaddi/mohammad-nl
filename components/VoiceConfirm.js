'use client';

import { useState, useEffect } from 'react';
import { formatNumber, getTodayDate, EXPENSE_CATEGORIES, PRODUCT_CATEGORIES } from '@/lib/utils';

export default function VoiceConfirm({ result, onConfirm, onCancel }) {
  if (!result) return null;

  const { action, data, warnings, transcript, question, missing_fields } = result;

  const formAction = action === 'clarification' ? 'register_expense' : action;
  const formData = action === 'clarification' ? (data || {}) : data;
  const formWarnings = action === 'clarification'
    ? [question || 'أكمل الحقول الفارغة', ...(warnings || [])]
    : (warnings || []);

  return (
    <EditableForm
      action={formAction}
      data={formData}
      warnings={formWarnings}
      transcript={transcript}
      missingFields={missing_fields || []}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function EditableForm({ action: initialAction, data, warnings, transcript, missingFields, onConfirm, onCancel }) {
  const [lastKey, setLastKey] = useState({ data, initialAction });
  const [form, setForm] = useState(() => (data ? { ...data } : {}));
  const [action, setAction] = useState(initialAction);
  if (lastKey.data !== data || lastKey.initialAction !== initialAction) {
    setLastKey({ data, initialAction });
    setForm(data ? { ...data } : {});
    setAction(initialAction);
  }
  const [saving, setSaving] = useState(false);
  const [dbData, setDbData] = useState({ products: [], clients: [], suppliers: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/products', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
      fetch('/api/clients', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
      fetch('/api/suppliers', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
    ]).then(([products, clients, suppliers]) => {
      if (cancelled) return;
      setDbData({
        products: Array.isArray(products) ? products : [],
        clients: Array.isArray(clients) ? clients : [],
        suppliers: Array.isArray(suppliers) ? suppliers : [],
      });
    });
    return () => { cancelled = true; };
  }, []);

  const actionLabels = { register_sale: 'بيع', register_purchase: 'شراء', register_expense: 'مصروف' };
  const actionColors = { register_sale: '#16a34a', register_purchase: '#1e40af', register_expense: '#f59e0b' };
  const color = actionColors[action] || '#1e40af';

  const handleSubmit = async () => {
    if (saving) return;

    if (action === 'register_sale') {
      if (!form.client_name) { alert('اسم العميل مطلوب'); return; }
      if (!form.item) { alert('المنتج مطلوب'); return; }
      if (!form.quantity || form.quantity <= 0) { alert('الكمية مطلوبة'); return; }
      if (!form.unit_price || form.unit_price <= 0) { alert('السعر مطلوب'); return; }
      // BUG-30: final-gate buy_price floor for the voice sale flow. The
      // server already marks unit_price in missing_fields (amber border)
      // when the extracted price violated the floor; this hard alert
      // catches the case where the user manually edited the field to a
      // still-invalid value after the voice extraction landed.
      const prodForSale = (dbData.products || []).find((p) => p.name === form.item);
      if (
        prodForSale &&
        prodForSale.buy_price > 0 &&
        parseFloat(form.unit_price) < prodForSale.buy_price
      ) {
        alert('سعر البيع أقل من سعر التكلفة. يرجى التصحيح قبل الحفظ.');
        return;
      }
    } else if (action === 'register_purchase') {
      if (!form.supplier) { alert('المورد مطلوب'); return; }
      if (!form.item) { alert('المنتج مطلوب'); return; }
      if (!form.quantity || form.quantity <= 0) { alert('الكمية مطلوبة'); return; }
      if (!form.unit_price || form.unit_price <= 0) { alert('السعر مطلوب'); return; }
      // BUG-30 mirror: the recommended sell_price for a purchase must be
      // >= the buy unit_price. The L401-415 visual warning already shows
      // the user the margin going red; this is the hard submit gate.
      // Only fires when sell_price was actually provided (0 means
      // "user/admin chose not to set a recommended price yet").
      const sellPriceVal = parseFloat(form.sell_price || form.sellPrice || 0);
      const unitPriceVal = parseFloat(form.unit_price || 0);
      if (sellPriceVal > 0 && unitPriceVal > 0 && sellPriceVal < unitPriceVal) {
        alert(
          `سعر البيع الموصى (${sellPriceVal}€) أقل من سعر الشراء (${unitPriceVal}€). يرجى التصحيح.`
        );
        return;
      }
    } else if (action === 'register_expense') {
      if (!form.category) { alert('الفئة مطلوبة'); return; }
      if (!form.description) { alert('الوصف مطلوب'); return; }
      if (!form.amount || form.amount <= 0) { alert('المبلغ مطلوب'); return; }
    }

    setSaving(true);

    try {
      await fetch('/api/voice/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcript || '', aiData: data || {}, userData: form, actionType: action }),
        cache: 'no-store',
      });
    } catch {} // Don't block save if learning fails

    const creates = [];
    if (action === 'register_sale') {
      if (form.client_name) creates.push(fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.client_name, phone: form.client_phone || '', address: form.client_address || '', email: form.client_email || '' }), cache: 'no-store' }).catch(() => {}));
      if (form.item) creates.push(fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.item }), cache: 'no-store' }).catch(() => {}));
    } else if (action === 'register_purchase') {
      if (form.supplier) creates.push(fetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.supplier }), cache: 'no-store' }).catch(() => {}));
      // DONE: Step 7 — pass the chosen category through so the product is filed correctly on first creation
      if (form.item) creates.push(fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.item, category: form.category || '' }), cache: 'no-store' }).catch(() => {}));
    }
    if (creates.length) await Promise.all(creates);

    const submitData = { ...form, date: getTodayDate() };
    delete submitData.isNewClient;
    delete submitData.isNewSupplier;
    delete submitData.action;

    let endpoint;
    if (action === 'register_sale') {
      endpoint = '/api/sales';
      submitData.clientName = form.client_name;
      submitData.unitPrice = form.unit_price;
      submitData.paymentType = form.payment_type || 'كاش';
      submitData.clientPhone = form.client_phone || '';
      submitData.clientAddress = form.client_address || '';
      submitData.clientEmail = form.client_email || '';
      // FEAT-04: pass through the down_payment_expected value. Empty string
      // means "use server-side reactive default based on payment_type".
      if (form.down_payment_expected !== undefined && form.down_payment_expected !== '') {
        submitData.downPaymentExpected = parseFloat(form.down_payment_expected) || 0;
      }
    } else if (action === 'register_purchase') {
      endpoint = '/api/purchases';
      submitData.unitPrice = form.unit_price;
      submitData.paymentType = form.payment_type || 'كاش';
      // DONE: Fix 5A — AI returns snake_case sell_price; keep camelCase fallback
      // for users who edit the field manually. Backend addPurchase reads sellPrice.
      submitData.sellPrice = form.sell_price || form.sellPrice || null;
      // DONE: Fix 5A — pass category through so addProduct files it correctly
      submitData.category = form.category || '';
    } else if (action === 'register_expense') {
      endpoint = '/api/expenses';
      submitData.paymentType = form.payment_type || 'كاش';
    }

    onConfirm(endpoint, submitData);
  };

  // Base input style
  const inputStyle = {
    padding: '8px 10px', borderRadius: '8px',
    fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem', width: '100%',
  };

  // Fields the AI left null get an amber border + tinted background to prompt the user.
  const fi = (fieldName) => ({
    ...inputStyle,
    border: missingFields.includes(fieldName)
      ? '2px solid #f59e0b'
      : '1.5px solid #d1d5db',
    background: missingFields.includes(fieldName) ? '#fffbeb' : undefined,
  });

  return (
    // Hotfix 2026-04-14: backdrop onClick removed. Voice extraction data
    // is expensive to re-enter (especially on mobile where accidental
    // taps are common), so the dialog only closes via the ✓ save button,
    // the × cancel button, or a successful save that unsets `result` in
    // the parent. No ESC handler exists for this div-based modal, so ESC
    // is already a no-op — no extra blocking needed.
    <div className="modal-overlay">
      <div className="detail-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="detail-modal-header">
          <div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              {Object.entries(actionLabels).map(([key, label]) => (
                <button key={key} onClick={() => setAction(key)} className="status-badge" style={{
                  background: action === key ? actionColors[key] : `${actionColors[key]}15`,
                  color: action === key ? 'white' : actionColors[key],
                  border: 'none', cursor: 'pointer', padding: '4px 12px', fontSize: '0.8rem',
                }}>{label}</button>
              ))}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 500 }}>
              🔬 وضع المساعد التجريبي — راجع كل حقل قبل الحفظ
            </div>
          </div>
          <button className="detail-modal-close" onClick={onCancel}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="detail-modal-body">
          {transcript && (
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '12px' }}>🎙️ سمعت: «{transcript}»</p>
          )}

          {warnings && warnings.length > 0 && (
            <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.78rem', color: '#92400e' }}>
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* Unconditional review banner. Copy adapts to whether the LLM
              flagged any missing fields. Catches confident-but-wrong LLM
              extractions that populate every field but still need review. */}
          <div style={{
            background: missingFields.length > 0 ? '#fff7ed' : '#eff6ff',
            padding: '6px 12px',
            borderRadius: '8px',
            marginBottom: '8px',
            fontSize: '0.75rem',
            color: missingFields.length > 0 ? '#c2410c' : '#1e40af',
            border: missingFields.length > 0 ? '1px solid #fdba74' : '1px solid #bfdbfe',
          }}>
            {missingFields.length > 0
              ? 'الحقول المميزة بالبرتقالي لم يفهمها الذكاء الاصطناعي — يرجى مراجعتها'
              : '✓ تأكد من صحة كل الحقول قبل الحفظ'}
          </div>

          {/* ── SALE FORM ──────���──────────────────────────────────── */}
          {action === 'register_sale' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  العميل {!dbData.clients.some((c) => c.name === form.client_name) && form.client_name && <span style={{ color: '#f59e0b' }}>(جديد)</span>}
                </label>
                <input style={fi('client_name')} list="vc-clients" value={form.client_name || ''} onChange={(e) => {
                  const client = dbData.clients.find((c) => c.name === e.target.value);
                  setForm({ ...form, client_name: e.target.value, client_phone: client?.phone || form.client_phone || '', client_email: client?.email || form.client_email || '', client_address: client?.address || form.client_address || '' });
                }} autoComplete="off" />
                <datalist id="vc-clients">{dbData.clients.map((c) => <option key={c.id} value={c.name} label={c.phone || ''} />)}</datalist>
                {/* DONE: Bug 1 — clientCandidates selector when same name has multiple matches */}
                {form.clientCandidates?.length > 0 && !form.client_name && (
                  <div style={{
                    background: '#fef3c7', border: '1px solid #f59e0b',
                    borderRadius: '8px', padding: '10px', marginTop: '6px',
                  }}>
                    <div style={{ fontSize: '0.78rem', color: '#92400e', marginBottom: '8px' }}>
                      ⚠ يوجد {form.clientCandidates.length} عملاء بهذا الاسم — اختر الصحيح:
                    </div>
                    {form.clientCandidates.map((name, i) => {
                      const client = dbData.clients.find((c) => c.name === name);
                      return (
                        <button key={i} type="button"
                          onClick={() => {
                            setForm({
                              ...form,
                              client_name: name,
                              client_phone: client?.phone || '',
                              client_email: client?.email || '',
                              client_address: client?.address || '',
                              clientCandidates: [],
                            });
                          }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'right',
                            padding: '8px 12px', margin: '4px 0',
                            background: 'white', border: '1px solid #d1d5db',
                            borderRadius: '6px', cursor: 'pointer',
                            fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem',
                          }}
                        >
                          {name}
                          {client?.phone && (
                            <span style={{ color: '#94a3b8', marginRight: '8px', fontSize: '0.75rem' }}>
                              {client.phone}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>هاتف العميل</label>
                  <input style={{ ...inputStyle, border: '1.5px solid #d1d5db', direction: 'ltr', textAlign: 'right' }} type="tel" value={form.client_phone || ''} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} placeholder="+31..." />
                  {/* DONE: Fix 5C — confirm AI extracted the phone from speech */}
                  {form.client_phone && (
                    <div style={{ fontSize: '0.72rem', color: '#16a34a', marginTop: '2px' }}>
                      ✓ فهم الرقم من الكلام
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>إيميل العميل</label>
                  <input style={{ ...inputStyle, border: '1.5px solid #d1d5db', direction: 'ltr', textAlign: 'right' }} type="email" value={form.client_email || ''} onChange={(e) => setForm({ ...form, client_email: e.target.value })} placeholder="email@..." />
                  {form.client_email && (
                    <div style={{ fontSize: '0.72rem', color: '#16a34a', marginTop: '2px' }}>
                      ✓ فهم الإيميل من الكلام
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>عنوان التوصيل</label>
                <input style={{ ...inputStyle, border: '1.5px solid #d1d5db' }} value={form.client_address || ''} onChange={(e) => setForm({ ...form, client_address: e.target.value })} placeholder="العنوان الكامل" />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  المنتج {!dbData.products.some((p) => p.name === form.item) && form.item && <span style={{ color: '#f59e0b' }}>(جديد)</span>}
                </label>
                <input style={fi('item')} list="vc-products" value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} autoComplete="off" />
                <datalist id="vc-products">{dbData.products.filter((p) => p.stock > 0).map((p) => <option key={p.id} value={p.name} label={`مخزون: ${p.stock}`} />)}</datalist>
                {/* DONE: Fix 7 — Arabic product name warning (sale form) */}
                {form.item && /[\u0600-\u06FF]/.test(form.item) && (
                  <div style={{
                    fontSize: '0.72rem',
                    color: '#dc2626',
                    background: '#fef2f2',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    marginTop: '3px',
                  }}>
                    ⚠ اسم المنتج يجب أن يكون بالإنجليزي — مثال: "V20 Pro - Noir" وليس "في عشرين برو أسود"
                  </div>
                )}
                {/* DONE: Bug 2 — surface "this product will be added" notice when AI detected a new product */}
                {form.suggestAddProduct && form.item && (
                  <div style={{
                    fontSize: '0.75rem', color: '#1e40af',
                    background: '#dbeafe', padding: '6px 10px',
                    borderRadius: '6px', marginTop: '4px',
                  }}>
                    💡 المنتج "{form.item}" غير موجود في القاعدة. سيُضاف تلقائياً عند التأكيد.
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الكمية</label>
                  <input style={fi('quantity')} type="number" min="0" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>سعر البيع</label>
                  <input style={fi('unit_price')} type="number" min="0" value={form.unit_price || ''} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color }}>
                الإجمالي: {formatNumber((form.quantity || 0) * (form.unit_price || 0))}
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>طريقة الدفع</label>
                <select style={fi('payment_type')} value={form.payment_type || 'كاش'} onChange={(e) => {
                  const newPT = e.target.value;
                  const defaultDpe = newPT === 'آجل' ? 0 : (form.quantity || 0) * (form.unit_price || 0);
                  setForm({ ...form, payment_type: newPT, down_payment_expected: defaultDpe });
                }}>
                  <option value="كاش">كاش (عند التوصيل)</option>
                  <option value="بنك">بنك (تحويل)</option>
                  <option value="آجل">آجل (دين)</option>
                </select>
              </div>
              {/* FEAT-04: down_payment_expected with reactive default.
                  On first render (data landing from /api/voice/process) we
                  seed the field if the server didn't. Editable by seller. */}
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الدفعة المقدمة المتوقعة (€)</label>
                <input
                  style={{ ...inputStyle, border: '1.5px solid #d1d5db' }}
                  type="number"
                  min="0"
                  step="0.01"
                  value={(() => {
                    if (form.down_payment_expected !== undefined && form.down_payment_expected !== null && form.down_payment_expected !== '') {
                      return form.down_payment_expected;
                    }
                    return form.payment_type === 'آجل' ? 0 : (form.quantity || 0) * (form.unit_price || 0);
                  })()}
                  onChange={(e) => setForm({ ...form, down_payment_expected: e.target.value })}
                  placeholder="يُحسب تلقائياً حسب طريقة الدفع"
                />
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                  المتبقي بعد التوصيل: {formatNumber(Math.max(0, ((form.quantity || 0) * (form.unit_price || 0)) - (parseFloat(form.down_payment_expected !== undefined && form.down_payment_expected !== '' ? form.down_payment_expected : (form.payment_type === 'آجل' ? 0 : (form.quantity || 0) * (form.unit_price || 0))) || 0)))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>ملاحظات</label>
                <input style={{ ...inputStyle, border: '1.5px solid #d1d5db' }} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
              </div>
            </div>
          )}

          {/* ── PURCHASE FORM ─────────────────────────────────────── */}
          {action === 'register_purchase' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  المورد {!dbData.suppliers.some((s) => s.name === form.supplier) && form.supplier && <span style={{ color: '#f59e0b' }}>(جديد)</span>}
                </label>
                <input style={fi('supplier')} list="vc-suppliers" value={form.supplier || ''} onChange={(e) => setForm({ ...form, supplier: e.target.value })} autoComplete="off" />
                <datalist id="vc-suppliers">{dbData.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  المنتج {!dbData.products.some((p) => p.name === form.item) && form.item && <span style={{ color: '#f59e0b' }}>(جديد)</span>}
                </label>
                <input style={fi('item')} list="vc-products2" value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} autoComplete="off" />
                <datalist id="vc-products2">{dbData.products.map((p) => <option key={p.id} value={p.name} label={`مخزون: ${p.stock || 0}`} />)}</datalist>
                {/* DONE: Fix 7 — Arabic product name warning (purchase form) */}
                {form.item && /[\u0600-\u06FF]/.test(form.item) && (
                  <div style={{
                    fontSize: '0.72rem',
                    color: '#dc2626',
                    background: '#fef2f2',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    marginTop: '3px',
                  }}>
                    ⚠ اسم المنتج يجب أن يكون بالإنجليزي — مثال: "V20 Pro - Noir" وليس "في عشرين برو أسود"
                  </div>
                )}
                {/* DONE: Bug 2 — same notice in PURCHASE FORM */}
                {form.suggestAddProduct && form.item && (
                  <div style={{
                    fontSize: '0.75rem', color: '#1e40af',
                    background: '#dbeafe', padding: '6px 10px',
                    borderRadius: '6px', marginTop: '4px',
                  }}>
                    💡 المنتج "{form.item}" غير موجود في القاعدة. سيُضاف تلقائياً عند التأكيد.
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الكمية</label>
                  <input style={fi('quantity')} type="number" min="0" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>سعر الشراء</label>
                  <input style={fi('unit_price')} type="number" min="0" value={form.unit_price || ''} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              {/* DONE: Fix 5B — sell_price input with AI-detection badge + live margin display */}
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  سعر البيع الموصى للزبون
                  {(form.sell_price || form.sellPrice) ? (
                    <span style={{ color: '#16a34a', marginRight: '6px', fontSize: '0.72rem' }}>
                      ✓ فهمه الذكاء الاصطناعي
                    </span>
                  ) : (
                    <span style={{ color: '#f59e0b', marginRight: '6px', fontSize: '0.72rem' }}>
                      يُنصح بإدخاله
                    </span>
                  )}
                </label>
                <input
                  style={fi('sell_price')}
                  type="number"
                  min="0"
                  value={form.sell_price ?? form.sellPrice ?? ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || null;
                    setForm({ ...form, sell_price: val, sellPrice: val });
                  }}
                  placeholder="سعر بيع المنتج للعميل"
                />
                {form.unit_price > 0 && (form.sell_price || form.sellPrice) > 0 && (
                  <div style={{
                    marginTop: '4px', fontSize: '0.75rem',
                    color: (form.sell_price || form.sellPrice) > form.unit_price ? '#16a34a' : '#dc2626',
                    background: (form.sell_price || form.sellPrice) > form.unit_price ? '#f0fdf4' : '#fef2f2',
                    padding: '4px 8px', borderRadius: '6px',
                  }}>
                    {(form.sell_price || form.sellPrice) > form.unit_price ? '💰' : '⚠️'} هامش الربح:{' '}
                    {formatNumber(
                      (((form.sell_price || form.sellPrice) - form.unit_price) /
                        (form.sell_price || form.sellPrice) * 100).toFixed(1)
                    )}%
                    ({formatNumber((form.sell_price || form.sellPrice) - form.unit_price)} لكل وحدة)
                  </div>
                )}
              </div>
              {/* DONE: Step 7 — category select for the purchase form */}
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>فئة المنتج</label>
                <select
                  style={fi('category')}
                  value={form.category || ''}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="">اختر فئة...</option>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color }}>
                الإجمالي: {formatNumber((form.quantity || 0) * (form.unit_price || 0))}
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الدفع</label>
                <select style={fi('payment_type')} value={form.payment_type || 'كاش'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش</option>
                  <option value="بنك">بنك</option>
                </select>
              </div>
            </div>
          )}

          {/* ── EXPENSE FORM ─────────────────���────────────────────── */}
          {action === 'register_expense' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الفئة</label>
                <select style={fi('category')} value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">اختر</option>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  الوصف التفصيلي
                  {/* DONE: Fix 5D — confirm AI captured the description */}
                  {form.description && (
                    <span style={{ color: '#16a34a', marginRight: '6px', fontSize: '0.72rem' }}>
                      ✓ فهمه الذكاء الاصطناعي
                    </span>
                  )}
                </label>
                <input style={fi('description')} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المبلغ</label>
                <input style={fi('amount')} type="number" min="0" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الدفع</label>
                <select style={fi('payment_type')} value={form.payment_type || 'كاش'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش</option>
                  <option value="بنك">بنك</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="detail-modal-footer">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmit} disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'تأكيد وحفظ'}
          </button>
          <button className="btn btn-outline" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
