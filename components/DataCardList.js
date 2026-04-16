'use client';

// v1.1 S3.2 — DataCardList: mobile card-fallback for data tables.
//
// On viewports below 640px (Tailwind `sm`), renders each row as a
// stacked card with full-width action buttons instead of the desktop
// horizontal-scroll table. The existing <table> is hidden; at sm and
// above, the table shows and cards hide. No JS media query — pure CSS.
//
// Usage in a page:
//
//   <DataCardList
//     rows={sortedRows}
//     fields={[
//       { key: 'ref_code', label: 'الرمز' },
//       { key: 'date',     label: 'التاريخ' },
//       { key: 'client_name', label: 'العميل' },
//       { key: 'total',    label: 'المبلغ', format: (v) => `${formatNumber(v)} €` },
//     ]}
//     actions={(row) => (
//       <>
//         <button className="btn btn-primary" onClick={() => ...}>تفاصيل</button>
//       </>
//     )}
//     statusField="status"
//     statusColors={{ 'مؤكد': '#16a34a', 'محجوز': '#f59e0b', 'ملغي': '#dc2626' }}
//   />
//
// The component renders:
//   <div className="data-card-list">  ← visible below sm, hidden at sm+
//     <div className="data-card">
//       <div className="data-card-status">مؤكد</div>
//       <div className="data-card-fields">
//         <div className="data-card-field"><span>العميل</span><span>أحمد</span></div>
//         ...
//       </div>
//       <div className="data-card-actions">...buttons...</div>
//     </div>
//   </div>
//
// CSS for the card layout is in globals.css under the `data-card-*` block.

import { formatNumber } from '@/lib/utils';

export default function DataCardList({
  rows,
  fields,
  actions,
  statusField,
  statusColors = {},
  emptyMessage = 'لا توجد بيانات',
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="data-card-list">
        <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="data-card-list">
      {rows.map((row, idx) => {
        const status = statusField ? row[statusField] : null;
        const statusColor = status ? (statusColors[status] || '#64748b') : null;

        return (
          <div key={row.id || idx} className="data-card">
            {status && (
              <div
                className="data-card-status"
                style={{ color: statusColor, borderColor: statusColor }}
              >
                {status}
              </div>
            )}
            <div className="data-card-fields">
              {fields.map((f) => {
                const raw = row[f.key];
                const display = f.format
                  ? f.format(raw, row)
                  : (raw != null && raw !== '' ? String(raw) : '—');
                return (
                  <div key={f.key} className="data-card-field">
                    <span className="data-card-label">{f.label}</span>
                    <span className="data-card-value">{display}</span>
                  </div>
                );
              })}
            </div>
            {actions && (
              <div className="data-card-actions">
                {actions(row)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
