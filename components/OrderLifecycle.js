'use client';

// OrderLifecycle — the 3-stage strip for one order: بيع → توصيل → فاتورة.
//
// An order in this app is a single chain: a sale auto-creates a delivery, and
// an invoice is generated once that delivery is completed (sale becomes مؤكد).
// So the sale's own status is enough to show the high-level stage WITHOUT
// fetching the delivery/invoice (Phase 1 — pure visibility, no extra queries):
//   • محجوز  → sold, awaiting delivery (+ invoice not issued yet)
//   • مؤكد   → delivered AND invoiced (all three done)
//   • ملغي   → cancelled
//
// Phase 2 will pass the real delivery sub-status / invoice link in so the
// middle/last steps can be more granular.

const STEPS = [
  { key: 'sale', label: 'بيع' },
  { key: 'delivery', label: 'توصيل' },
  { key: 'invoice', label: 'فاتورة' },
];

function stateFor(status) {
  if (status === 'ملغي') return { sale: 'cancelled', delivery: 'cancelled', invoice: 'cancelled' };
  if (status === 'مؤكد') return { sale: 'done', delivery: 'done', invoice: 'done' };
  // محجوز (default): sold, delivery is the current/next step, invoice not yet.
  return { sale: 'done', delivery: 'current', invoice: 'todo' };
}

const COLOR = { done: '#16a34a', current: '#d97706', cancelled: '#dc2626', todo: '#cbd5e1' };
const ICON = { done: '✓', current: '⏳', cancelled: '✕', todo: '○' };

export default function OrderLifecycle({ status }) {
  const st = stateFor(status);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {STEPS.map((step, i) => {
        const s = st[step.key];
        const color = COLOR[s] || COLOR.todo;
        return (
          <span key={step.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span aria-hidden style={{ width: 14, height: 2, background: '#e2e8f0', display: 'inline-block' }} />}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', fontWeight: 700, color }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.62rem', lineHeight: 1 }}>
                {ICON[s] || ICON.todo}
              </span>
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
