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

// DONE: Step 1 — product taxonomy used by stock filters, purchase form, voice flow, summary breakdown
export const PRODUCT_CATEGORIES = [
  'دراجات كهربائية',
  'دراجات عادية',
  'إكسسوارات',
  'قطع تبديل',
  'بطاريات',
  'شواحن',
  'أخرى',
];

// DONE: Step 6
// Payment + category lookup tables used by /api/voice/process. Single
// source of truth — adding a synonym here is picked up by the route on
// the next request. (PERF-03 removed the legacy /api/voice/extract route
// that this comment used to also reference.)
export const PAYMENT_MAP = {
  cash:   'كاش',
  bank:   'بنك',
  credit: 'آجل',
  // Arabic identity (LLM may already return Arabic)
  'كاش':  'كاش',
  'بنك':  'بنك',
  'آجل':  'آجل',
  // Synonyms users actually say
  'نقدي':       'كاش',
  'نقد':        'كاش',
  'تحويل':      'بنك',
  'حوالة':      'بنك',
  'دين':        'آجل',
  'بعدين':      'آجل',
  'على الحساب': 'آجل',
};

export const CATEGORY_MAP = {
  rent:        'إيجار',
  salaries:    'رواتب',
  transport:   'نقل وشحن',
  maintenance: 'صيانة وإصلاح',
  marketing:   'تسويق وإعلان',
  utilities:   'كهرباء وماء',
  insurance:   'تأمين',
  tools:       'أدوات ومعدات',
  other:       'أخرى',
  // Arabic identity for every category
  'إيجار':         'إيجار',
  'رواتب':         'رواتب',
  'نقل وشحن':      'نقل وشحن',
  'صيانة وإصلاح':  'صيانة وإصلاح',
  'تسويق وإعلان':  'تسويق وإعلان',
  'كهرباء وماء':   'كهرباء وماء',
  'تأمين':         'تأمين',
  'أدوات ومعدات':  'أدوات ومعدات',
  'أخرى':          'أخرى',
};
