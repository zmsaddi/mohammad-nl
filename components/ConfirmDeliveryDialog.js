'use client';

import { useState, useEffect, useRef } from 'react';
import { formatNumber } from '@/lib/utils';

// Shared confirm-delivery flow (amount to collect → VIN), so it can be triggered
// from the orders hub as well as the deliveries page. It PUTs /api/deliveries
// with the FULL delivery body + status='تم التوصيل'; the server turns that into
// confirm-sale + collect-payment + invoice + bonuses (the single money path).
//
// `delivery` is a row from /api/deliveries (carries down_payment_expected,
// total_amount, sale_payment_type, vin, …). Permission to confirm is enforced
// by the API (admin/manager, or the assigned driver) — the caller decides who
// sees the trigger.

const BIKE_KEYWORDS = ['bike', 'دراجة', 'ebike', 'e-bike', 'scooter', 'sur-ron', 'aperyder'];
function isBike(items) {
  return BIKE_KEYWORDS.some((k) => (items || '').toLowerCase().includes(k));
}

export default function ConfirmDeliveryDialog({ delivery, onClose, onSuccess, addToast }) {
  const [step, setStep] = useState('amount');
  const [vin, setVin] = useState(delivery?.vin || '');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const requireVin = isBike(delivery?.items);
  const vinReady = vin.trim().length > 0;

  useEffect(() => {
    if (step !== 'vin') return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [step]);

  if (!delivery) return null;

  const submit = async () => {
    if (requireVin && !vin.trim()) { addToast('رقم VIN مطلوب لتأكيد توصيل الدراجة', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/deliveries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: delivery.id,
          date: String(delivery.date || '').slice(0, 10),
          clientName: delivery.client_name || '',
          clientPhone: delivery.client_phone || '',
          address: delivery.address || '',
          items: delivery.items || '',
          totalAmount: parseFloat(delivery.total_amount) || 0,
          status: 'تم التوصيل',
          driverName: delivery.driver_name || '',
          assignedDriver: delivery.assigned_driver || '',
          notes: delivery.notes || '',
          vin: vin.trim().toUpperCase() || delivery.vin || '',
        }),
        cache: 'no-store',
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { addToast('تم تأكيد التسليم وإنشاء الفاتورة'); onSuccess(); }
      else { addToast(d.error || 'خطأ في تأكيد التسليم', 'error'); setSubmitting(false); }
    } catch {
      addToast('خطأ في الاتصال', 'error');
      setSubmitting(false);
    }
  };

  if (step === 'amount') {
    const dpe = parseFloat(delivery.down_payment_expected) || 0;
    const totalAmt = parseFloat(delivery.total_amount) || 0;
    const salePaymentType = delivery.sale_payment_type || delivery.payment_type;
    const remainingAfter = Math.max(0, totalAmt - dpe);
    return (
      <div className="modal-overlay">
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <h3>تأكيد التسليم</h3>
          <div style={{ margin: '16px 0', padding: 16, background: '#f8fafc', borderRadius: 12 }}>
            <div style={{ marginBottom: 8, color: '#64748b', fontSize: '0.85rem' }}>العميل: <strong style={{ color: '#1e293b' }}>{delivery.client_name}</strong></div>
            <div style={{ marginBottom: 8, color: '#64748b', fontSize: '0.85rem' }}>الأصناف: <strong style={{ color: '#1e293b' }}>{delivery.items}</strong></div>
            {totalAmt > 0 && (
              dpe <= 0 && salePaymentType === 'آجل' ? (
                <div style={{ padding: 12, background: '#fef3c7', borderRadius: 10, textAlign: 'center', marginTop: 12 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>دين على العميل — لا تحصّل شيء الآن</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#d97706' }}>إجمالي الدين: {formatNumber(totalAmt)}</div>
                </div>
              ) : (
                <div style={{ padding: 12, background: remainingAfter > 0 ? '#ffedd5' : '#dcfce7', borderRadius: 10, textAlign: 'center', marginTop: 12 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>المبلغ المطلوب تحصيله الآن</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: remainingAfter > 0 ? '#9a3412' : '#16a34a' }}>{formatNumber(dpe)}</div>
                  {remainingAfter > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: 6 }}>المتبقي بعد هذه الدفعة: {formatNumber(remainingAfter)} (يُحصّل لاحقاً)</div>
                  )}
                </div>
              )
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep('vin')}>تأكيد ← التالي</button>
            <button className="btn btn-outline" onClick={onClose}>إلغاء</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3>
          رقم الهيكل (VIN)
          {requireVin && <span style={{ color: '#dc2626', fontSize: '0.85rem' }}> *مطلوب للدراجات</span>}
        </h3>
        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
          {requireVin ? 'هذه دراجة — يجب إدخال رقم الهيكل قبل تأكيد التوصيل.' : 'هذا المنتج ليس دراجة — يمكنك تخطي رقم الهيكل.'}
        </p>
        <div className="form-group" style={{ margin: '16px 0' }}>
          <input
            ref={inputRef}
            type="text"
            value={vin}
            onChange={(e) => setVin(e.target.value)}
            placeholder="مثال: WB10A1234Z5678"
            style={{ direction: 'ltr', textAlign: 'center', fontSize: '1.1rem', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', border: requireVin && !vinReady ? '2px solid #dc2626' : undefined }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={(requireVin && !vinReady) || submitting} onClick={submit}>
            {submitting ? 'جارٍ…' : (requireVin ? 'تأكيد مع VIN' : (vinReady ? 'تأكيد مع VIN' : 'تخطي وتأكيد'))}
          </button>
          <button className="btn btn-outline" onClick={() => setStep('amount')}>رجوع</button>
        </div>
      </div>
    </div>
  );
}
