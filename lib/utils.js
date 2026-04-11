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

// Get today's date in YYYY-MM-DD format
export function getTodayDate() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// Calculate debt for a client
export function calculateClientDebt(sales, payments) {
  const totalCreditSales = sales
    .filter((s) => s['طريقة الدفع'] === 'آجل')
    .reduce((sum, s) => sum + (parseFloat(s['الإجمالي']) || 0), 0);

  const totalPaidAtSale = sales
    .filter((s) => s['طريقة الدفع'] === 'آجل')
    .reduce((sum, s) => sum + (parseFloat(s['المبلغ المدفوع']) || 0), 0);

  const totalPayments = payments.reduce(
    (sum, p) => sum + (parseFloat(p['المبلغ']) || 0),
    0
  );

  return totalCreditSales - totalPaidAtSale - totalPayments;
}

// Expense categories
export const EXPENSE_CATEGORIES = [
  'إيجار',
  'رواتب',
  'نقل',
  'خدمات',
  'صيانة',
  'أخرى',
];
