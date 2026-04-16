'use client';

const PRESETS = {
  'مؤكد':       { bg: '#dcfce7', color: '#16a34a' },
  'محجوز':      { bg: '#fef3c7', color: '#f59e0b' },
  'ملغي':       { bg: '#fee2e2', color: '#dc2626' },
  'تم التوصيل': { bg: '#dcfce7', color: '#16a34a' },
  'جاري التوصيل': { bg: '#dbeafe', color: '#3b82f6' },
  'قيد الانتظار': { bg: '#fef3c7', color: '#f59e0b' },
  'مدفوع':      { bg: '#dcfce7', color: '#16a34a' },
  'جزئي':       { bg: '#fef3c7', color: '#d97706' },
  'معلق':       { bg: '#fee2e2', color: '#dc2626' },
  'متوفر':      { bg: '#dcfce7', color: '#16a34a' },
  'منخفض':      { bg: '#fef3c7', color: '#d97706' },
  'نفذ':        { bg: '#fee2e2', color: '#dc2626' },
  'تم الصرف':   { bg: '#dcfce7', color: '#16a34a' },
  'مستحق':      { bg: '#fef3c7', color: '#d97706' },
  'كاش':        { bg: '#dcfce7', color: '#16a34a' },
  'بنك':        { bg: '#dbeafe', color: '#1e40af' },
  'آجل':        { bg: '#fef3c7', color: '#d97706' },
  'مدير عام':   { bg: '#fee2e2', color: '#dc2626' },
  'مشرف':       { bg: '#dbeafe', color: '#1e40af' },
  'بائع':       { bg: '#dcfce7', color: '#16a34a' },
  'سائق':       { bg: '#ede9fe', color: '#7c3aed' },
};

export default function StatusBadge({ status, bg, color }) {
  const preset = PRESETS[status] || { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span
      className="status-badge"
      style={{ background: bg || preset.bg, color: color || preset.color }}
    >
      {status}
    </span>
  );
}
