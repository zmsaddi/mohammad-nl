'use client';

// OrderLifecycle — the 3-stage strip for one order: بيع → توصيل → فاتورة.
//
// An order is a chain: a sale auto-creates a delivery, and an invoice is issued
// once that delivery completes. Phase 2 feeds the REAL delivery status + the
// invoice presence in, so the middle/last steps are accurate (not just derived
// from the sale status):
//
//   props:
//     saleStatus       — 'محجوز' | 'مؤكد' | 'ملغي'
//     deliveryStatus?  — 'قيد الانتظار' | 'جاري التوصيل' | 'تم التوصيل' | 'ملغي'
//     hasInvoice?      — boolean (an invoice ref exists)
//
// Stage states → colour/icon:
//   done (green ✓) · transit (blue ⇄, out for delivery) · waiting (amber ⏳)
//   · todo (grey ○, not reached yet) · cancelled (red ✕)

const STEP_LABELS = { sale: 'بيع', delivery: 'توصيل', invoice: 'فاتورة' };
const COLOR = { done: '#16a34a', transit: '#2563eb', waiting: '#d97706', todo: '#cbd5e1', cancelled: '#dc2626' };
const ICON = { done: '✓', transit: '⇄', waiting: '⏳', todo: '○', cancelled: '✕' };

function computeStages({ saleStatus, deliveryStatus, hasInvoice }) {
  if (saleStatus === 'ملغي' || deliveryStatus === 'ملغي') {
    return { sale: 'cancelled', delivery: 'cancelled', invoice: 'cancelled' };
  }
  // The order exists, so the sale step is always done.
  const sale = 'done';

  let delivery;
  if (deliveryStatus === 'تم التوصيل') delivery = 'done';
  else if (deliveryStatus === 'جاري التوصيل') delivery = 'transit';
  else if (deliveryStatus === 'قيد الانتظار') delivery = 'waiting';
  else delivery = saleStatus === 'مؤكد' ? 'done' : 'waiting'; // no delivery row yet → fall back to sale status

  const invoiced = hasInvoice || saleStatus === 'مؤكد';
  const invoice = invoiced ? 'done' : 'todo';
  return { sale, delivery, invoice };
}

export default function OrderLifecycle(props) {
  const stages = computeStages(props);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {['sale', 'delivery', 'invoice'].map((key, i) => {
        const s = stages[key];
        const color = COLOR[s] || COLOR.todo;
        return (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span aria-hidden style={{ width: 14, height: 2, background: '#e2e8f0', display: 'inline-block' }} />}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', fontWeight: 700, color }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.62rem', lineHeight: 1 }}>
                {ICON[s] || ICON.todo}
              </span>
              {STEP_LABELS[key]}
            </span>
          </span>
        );
      })}
    </div>
  );
}
