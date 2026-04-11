'use client';

import { useState, useEffect } from 'react';
import { formatNumber, getTodayDate, EXPENSE_CATEGORIES } from '@/lib/utils';

export default function VoiceConfirm({ result, onConfirm, onCancel }) {
  if (!result) return null;

  const { action, data, warnings, transcript, question, missing_fields } = result;

  // Clarification → show as info then let user try again
  if (action === 'clarification') {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
          <h3 style={{ textAlign: 'center' }}>معلومات ناقصة</h3>
          {transcript && <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>سمعت: "{transcript}"</p>}
          <div style={{ background: '#fefce8', padding: '12px', borderRadius: '10px', margin: '12px 0', textAlign: 'center', fontSize: '1rem', fontWeight: 600, color: '#92400e' }}>
            {question || 'لم أفهم - حاول مرة أخرى'}
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={onCancel}>حاول مرة أخرى</button>
          </div>
        </div>
      </div>
    );
  }

  // Data extracted → editable form
  return <EditableForm action={action} data={data} warnings={warnings} transcript={transcript} onConfirm={onConfirm} onCancel={onCancel} />;
}

function EditableForm({ action, data, warnings, transcript, onConfirm, onCancel }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    if (data) setForm({ ...data });
  }, [data]);

  const actionLabels = { register_sale: 'بيع', register_purchase: 'شراء', register_expense: 'مصروف' };
  const actionColors = { register_sale: '#16a34a', register_purchase: '#1e40af', register_expense: '#f59e0b' };
  const color = actionColors[action] || '#1e40af';

  const handleSubmit = () => {
    const submitData = { ...form, date: getTodayDate() };
    // Clean up internal flags
    delete submitData.isNewClient;
    delete submitData.isNewSupplier;
    delete submitData.action;

    let endpoint;
    if (action === 'register_sale') {
      endpoint = '/api/sales';
      submitData.clientName = form.client_name;
      submitData.unitPrice = form.unit_price;
      submitData.paymentType = form.payment_type;
    } else if (action === 'register_purchase') {
      endpoint = '/api/purchases';
      submitData.unitPrice = form.unit_price;
      submitData.paymentType = form.payment_type;
    } else if (action === 'register_expense') {
      endpoint = '/api/expenses';
      submitData.paymentType = form.payment_type;
    }
    onConfirm(endpoint, submitData);
  };

  const inputStyle = { padding: '8px 10px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem', width: '100%' };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="detail-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="detail-modal-header">
          <h3>
            <span className="status-badge" style={{ background: `${color}20`, color, marginLeft: '8px' }}>
              {actionLabels[action]}
            </span>
            تأكيد ومراجعة
          </h3>
          <button className="detail-modal-close" onClick={onCancel}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="detail-modal-body">
          {transcript && <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '12px' }}>🎙️ سمعت: "{transcript}"</p>}

          {warnings && warnings.length > 0 && (
            <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.78rem', color: '#92400e' }}>
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* SALE FORM */}
          {action === 'register_sale' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>العميل {form.isNewClient && <span style={{ color: '#f59e0b' }}>(جديد)</span>}</label>
                <input style={inputStyle} value={form.client_name || ''} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المنتج</label>
                <input style={inputStyle} value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الكمية</label>
                  <input style={inputStyle} type="number" min="0" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', color: '#64748b' }}>سعر الوحدة</label>
                  <input style={inputStyle} type="number" min="0" value={form.unit_price || ''} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color }}>
                الإجمالي: {formatNumber((form.quantity || 0) * (form.unit_price || 0))}
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>الدفع</label>
                <select style={inputStyle} value={form.payment_type || 'cash'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش</option>
                  <option value="بنك">بنك</option>
                  <option value="آجل">آجل</option>
                </select>
              </div>
            </div>
          )}

          {/* PURCHASE FORM */}
          {action === 'register_purchase' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المورد {form.isNewSupplier && <span style={{ color: '#f59e0b' }}>(جديد)</span>}</label>
                <input style={inputStyle} value={form.supplier || ''} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#64748b' }}>المنتج</label>
                <input style={inputStyle} value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} />
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
                <select style={inputStyle} value={form.payment_type || 'cash'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
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
                <select style={inputStyle} value={form.payment_type || 'cash'} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                  <option value="كاش">كاش</option>
                  <option value="بنك">بنك</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="detail-modal-footer">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmit}>تأكيد وحفظ</button>
          <button className="btn btn-outline" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
