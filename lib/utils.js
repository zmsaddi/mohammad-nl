// Format number with commas for Arabic display
export function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '0';
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Format date for display
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// Get today's date in YYYY-MM-DD using the business timezone, not UTC.
// Without this, sales made late at night land on the next day's report.
const BUSINESS_TZ = 'Europe/Amsterdam';
export function getTodayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

// Expense categories
export const EXPENSE_CATEGORIES = [
  'إيجار',
  'رواتب',
  'نقل وشحن',
  'صيانة وإصلاح',
  'تسويق وإعلان',
  'كهرباء وماء',
  'تأمين',
  'أدوات ومعدات',
  'أخرى',
];
