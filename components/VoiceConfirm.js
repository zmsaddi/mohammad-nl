'use client';

import { useState } from 'react';
import { formatNumber, getTodayDate } from '@/lib/utils';

export default function VoiceConfirm({ result, onConfirm, onCancel, onRetry }) {
  if (!result) return null;

  const { action, data, warnings, transcript, question, missing_fields } = result;

  // Clarification needed
  if (action === 'clarification') {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fef3c7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#f59e0b" width="24" height="24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </div>
          </div>
          <h3 style={{ textAlign: 'center' }}>معلومات ناقصة</h3>
          {transcript && <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '8px' }}>سمعت: "{transcript}"</p>}
          <div style={{ background: '#fefce8', padding: '12px', borderRadius: '10px', margin: '12px 0', textAlign: 'center', fontSize: '1rem', fontWeight: 600, color: '#92400e' }}>
            {question}
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={onRetry}>سجّل مرة أخرى</button>
            <button className="btn btn-outline" onClick={onCancel}>إلغاء</button>
          </div>
        </div>
      </div>
    );
  }

  // Data extracted - show confirmation
  const actionLabels = { register_sale: 'بيع', register_purchase: 'شراء', register_expense: 'مصروف' };
  const actionColors = { register_sale: '#16a34a', register_purchase: '#1e40af', register_expense: '#f59e0b' };

  const fields = [];
  if (action === 'register_sale') {
    fields.push({ label: 'العميل', value: data.client_name });
    fields.push({ label: 'المنتج', value: data.item });
    fields.push({ label: 'الكمية', value: data.quantity });
    fields.push({ label: 'سعر الوحدة', value: formatNumber(data.unit_price) });
    fields.push({ label: 'الإجمالي', value: formatNumber((data.quantity || 0) * (data.unit_price || 0)), highlight: true });
    fields.push({ label: 'الدفع', value: data.payment_type });
  } else if (action === 'register_purchase') {
    fields.push({ label: 'المورد', value: data.supplier });
    fields.push({ label: 'المنتج', value: data.item });
    fields.push({ label: 'الكمية', value: data.quantity });
    fields.push({ label: 'سعر الوحدة', value: formatNumber(data.unit_price) });
    fields.push({ label: 'الإجمالي', value: formatNumber((data.quantity || 0) * (data.unit_price || 0)), highlight: true });
    fields.push({ label: 'الدفع', value: data.payment_type });
  } else if (action === 'register_expense') {
    fields.push({ label: 'الفئة', value: data.category });
    fields.push({ label: 'الوصف', value: data.description });
    fields.push({ label: 'المبلغ', value: formatNumber(data.amount), highlight: true });
    fields.push({ label: 'الدفع', value: data.payment_type });
  }

  const handleConfirm = () => {
    const submitData = { ...data, date: getTodayDate() };
    let endpoint;
    if (action === 'register_sale') endpoint = '/api/sales';
    else if (action === 'register_purchase') endpoint = '/api/purchases';
    else if (action === 'register_expense') endpoint = '/api/expenses';
    onConfirm(endpoint, submitData);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: `${actionColors[action]}20`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={actionColors[action]} width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
          <span className="status-badge" style={{ background: `${actionColors[action]}20`, color: actionColors[action], fontSize: '0.9rem', padding: '4px 16px' }}>
            {actionLabels[action] || action}
          </span>
        </div>

        {transcript && <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '12px' }}>سمعت: "{transcript}"</p>}

        <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '12px', margin: '12px 0' }}>
          {fields.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < fields.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{f.label}</span>
              <span style={{ fontWeight: f.highlight ? 700 : 600, color: f.highlight ? actionColors[action] : '#1e293b', fontSize: f.highlight ? '1.1rem' : '0.95rem' }}>
                {f.value}
              </span>
            </div>
          ))}
        </div>

        {warnings && warnings.length > 0 && (
          <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: '8px', margin: '8px 0', fontSize: '0.8rem', color: '#92400e' }}>
            {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '16px' }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirm}>تأكيد وحفظ</button>
          <button className="btn btn-outline" onClick={onRetry}>تعديل / إعادة</button>
          <button className="btn btn-outline" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
