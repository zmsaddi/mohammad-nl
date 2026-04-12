'use client';

import { useState, useEffect } from 'react';
import { formatNumber, getTodayDate, EXPENSE_CATEGORIES } from '@/lib/utils';

export default function VoiceConfirm({ result, onConfirm, onCancel }) {
  if (!result) return null;

  const { action, data, warnings, transcript, question, missing_fields } = result;

  // ALWAYS open editable form - even with partial data
  const formAction = action === 'clarification' ? 'register_expense' : action;
  const formData = action === 'clarification' ? (data || {}) : data;
  const formWarnings = action === 'clarification'
    ? [question || 'أكمل الحقول الفارغة', ...(warnings || [])]
    : (warnings || []);

  return <EditableForm action={formAction} data={formData} warnings={formWarnings} transcript={transcript} onConfirm={onConfirm} onCancel={onCancel} />;
}

function EditableForm({ action: initialAction, data, warnings, transcript, onConfirm, onCancel }) {
  // Derive form/action from props synchronously instead of mirroring them through
  // setState in useEffect (which would trigger cascading renders in React 19).
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
      fetch('/api/products').then((r) => r.json()).catch(() => []),
      fetch('/api/clients').then((r) => r.json()).catch(() => []),
      fetch('/api/suppliers').then((r) => r.json()).catch(() => []),
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

    // Validate required fields
    if (action === 'register_sale') {
      if (!form.client_name) { alert('اسم العميل مطلوب'); return; }
      if (!form.item) { alert('المنتج مطلوب'); return; }
      if (!form.quantity || form.quantity <= 0) { alert('الكمية مطلوبة'); return; }
      if (!form.unit_price || form.unit_price <= 0) { alert('السعر مطلوب'); return; }
    } else if (action === 'register_purchase') {
      if (!form.supplier) { alert('المورد مطلوب'); return; }
      if (!form.item) { alert('المنتج مطلوب'); return; }
      if (!form.quantity || form.quantity <= 0) { alert('الكمية مطلوبة'); return; }
      if (!form.unit_price || form.unit_price <= 0) { alert('السعر مطلوب'); return; }
    } else if (action === 'register_expense') {
      if (!form.category) { alert('الفئة مطلوبة'); return; }
      if (!form.description) { alert('الوصف مطلوب'); return; }
      if (!form.amount || form.amount <= 0) { alert('المبلغ مطلوب'); return; }
    }

    setSaving(true);

    // LEARN: Send corrections to AI learning endpoint
    try {
      await fetch('/api/voice/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript || '',
          aiData: data || {},
          userData: form,
          actionType: action,
        }),
      });
    } catch {} // Don't block save if learning fails

    // Step 1: Auto-create entities FIRST (before main save)
    const creates = [];
    if (action === 'register_sale') {
      if (form.client_name) creates.push(fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.client_name, phone: form.client_phone || '', address: form.client_address || '', email: form.client_email || '' }) }).catch(() => {}));
      if (form.item) creates.push(fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.item }) }).catch(() => {}));
    } else if (action === 'register_purchase') {
      if (form.supplier) creates.push(fetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.supplier }) }).catch(() => {}));
      if (form.item) creates.push(fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.item }) }).catch(() => {}));
    }
    if (creates.length) await Promise.all(creates);

    // Step 2: Build submit data
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
    } else if (action === 'register_purchase') {
      endpoint = '/api/purchases';
      submitData.unitPrice = form.unit_price;
      submitData.paymentType = form.payment_type || 'كاش';
      submitData.sellPrice = form.sellPrice || '';
    } else if (action === 'register_expense') {
      endpoint = '/api/expenses';
      submitData.paymentType = form.payment_type || 'كاش';
    }

    // Step 3: Save main record
    onConfirm(endpoint, submitData);
  };

  const inputStyle = { padding: '8px 10px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem', width: '100%' };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="detail-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="detail-modal-header">
          <div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              {Object.entries(actionLabels).map(([key, label]) => (
                <button key={key} onClick={() => setAction(key)} className="status-badge" style={{
                  background: action === key ? `${actionColors[key]}` : `${actionColors[key]}15`,
                  color: action === key ? 'white' : actionColors[key],
                  border: 'none', cursor: 'pointer', padding: '4px 12px', fontSize: '0.8rem',
                }}>{label}</button>
              ))}
            </div>
          </div>
          <button className="detail-modal-close" onClick={onCancel}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="detail-modal-body">
          {transcript && <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '12px' }}>🎙️ سمعت: «{transcript}»</p>}

          {warnings && warnings.length > 0 && (
            <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.78rem', color: '#92400e' }}>
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* SALE FORM */}
          {action === 'register_sale' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>العميل {!dbData.clients.some((c) => c.name === form.client_name) && form.client_name && <span style={{ color: '#f59e0b' }}>(جديد)</span>}</label>
                <input style={inputStyle} list="vc-clients" value={form.client_name || ''} onChange={(e) => {
                  const client = dbData.clients.find((c) => c.name === e.target.value);
                  setForm({ ...form, client_name: e.target.value, client_phone: client?.phone || form.client_phone || '', client_email: client?.email || form.client_email || '', client_address: client?.address || form.client_address || '' });
                }} autoComplete="off" />
                <datalist id="vc-clients">{dbData.clients.map((c) => <option key={c.id} value={c.name} label={c.phone || ''} />)}</datalist>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>هاتف العميل</label>
                  <input style={{ ...inputStyle, direction: 'ltr', textAlign: 'right' }} type="tel" value={form.client_phone || ''} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} placeholder="+31..." />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>إيميل العميل</label>
                  <input style={{ ...inputStyle, direction: 'ltr', textAlign: 'right' }} type="email" value={form.client_email || ''} onChange={(e) => setForm({ ...form, client_email: e.target.value })} placeholder="email@..." />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>عنوان التوصيل</label>
                <input style={inputStyle} value={form.client_address || ''} onChange={(e) => setForm({ ...form, client_address: e.target.value })} placeholder="العنوان الكامل" />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المنتج {!dbData.products.some((p) => p.name === form.item) && form.item && <span style={{ color: '#f59e0b' }}>(جديد)</span>}</label>
                <input style={inputStyle} list="vc-products" value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} autoComplete="off" />
                <datalist id="vc-products">{dbData.products.filter((p) => p.stock > 0).map((p) => <option key={p.id} value={p.name} label={`مخزون: ${p.stock}`} />)}</datalist>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الكمية</label>
                  <input style={inputStyle} type="number" min="0" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>سعر البيع</label>
                  <input style={inputStyle} type="number" min="0" value={form.unit_price || ''} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color }}>
                الإجمالي: {formatNumber((form.quantity || 0) * (form.unit_price || 0))}
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>طريقة الدفع</label>
                <select style={inputStyle} value={form.payment_type || 'كاش'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش (عند التوصيل)</option>
                  <option value="بنك">بنك (تحويل)</option>
                  <option value="آجل">آجل (دين)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>ملاحظات</label>
                <input style={inputStyle} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
              </div>
            </div>
          )}

          {/* PURCHASE FORM */}
          {action === 'register_purchase' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المورد {!dbData.suppliers.some((s) => s.name === form.supplier) && form.supplier && <span style={{ color: '#f59e0b' }}>(جديد)</span>}</label>
                <input style={inputStyle} list="vc-suppliers" value={form.supplier || ''} onChange={(e) => setForm({ ...form, supplier: e.target.value })} autoComplete="off" />
                <datalist id="vc-suppliers">{dbData.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المنتج {!dbData.products.some((p) => p.name === form.item) && form.item && <span style={{ color: '#f59e0b' }}>(جديد)</span>}</label>
                <input style={inputStyle} list="vc-products2" value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} autoComplete="off" />
                <datalist id="vc-products2">{dbData.products.map((p) => <option key={p.id} value={p.name} label={`مخزون: ${p.stock || 0}`} />)}</datalist>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الكمية</label>
                  <input style={inputStyle} type="number" min="0" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>سعر الشراء</label>
                  <input style={inputStyle} type="number" min="0" value={form.unit_price || ''} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>سعر البيع الموصى</label>
                <input style={inputStyle} type="number" min="0" value={form.sellPrice || ''} onChange={(e) => setForm({ ...form, sellPrice: parseFloat(e.target.value) || 0 })} placeholder="اختياري" />
              </div>
              <div style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color }}>
                الإجمالي: {formatNumber((form.quantity || 0) * (form.unit_price || 0))}
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الدفع</label>
                <select style={inputStyle} value={form.payment_type || 'كاش'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش</option>
                  <option value="بنك">بنك</option>
                </select>
              </div>
            </div>
          )}

          {/* EXPENSE FORM */}
          {action === 'register_expense' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الفئة</label>
                <select style={inputStyle} value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">اختر</option>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الوصف</label>
                <input style={inputStyle} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المبلغ</label>
                <input style={inputStyle} type="number" min="0" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الدفع</label>
                <select style={inputStyle} value={form.payment_type || 'كاش'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش</option>
                  <option value="بنك">بنك</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="detail-modal-footer">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmit} disabled={saving}>{saving ? 'جاري الحفظ...' : 'تأكيد وحفظ'}</button>
          <button className="btn btn-outline" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
