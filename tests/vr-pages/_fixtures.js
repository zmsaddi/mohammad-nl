// Deterministic API fixtures for page-level visual regression. Playwright
// intercepts every /api/* request (except /api/auth/*) and fulfils it from here,
// so pages render populated, stable UI without a DB. Endpoints not listed return
// an empty array (pages then show their empty state — still a valid snapshot).

const sales = [
  { id: 1, date: '2026-05-01', client_name: 'أحمد المصري', item: 'دراجة كهربائية', quantity: 1, unit_price: 1500, total: 1500, buy_price: 1100, payment_type: 'كاش', status: 'مؤكد', payment_status: 'مدفوع', seller_name: 'بائع تجريبي', vin: 'VIN-0001', remaining: 0, paid_amount: 1500 },
  { id: 2, date: '2026-05-03', client_name: 'سارة علي', item: 'إكسسوار', quantity: 2, unit_price: 120, total: 240, buy_price: 80, payment_type: 'آجل', status: 'محجوز', payment_status: 'جزئي', seller_name: 'بائع تجريبي', vin: '', remaining: 100, paid_amount: 140 },
];

const clients = [
  { id: 1, name: 'Ahmad', description_ar: 'أحمد المصري', phone: '0612345678', email: 'a@x.com', address: 'Amsterdam', debt: 100, total_debt: 100 },
  { id: 2, name: 'Sara', description_ar: 'سارة علي', phone: '0698765432', email: '', address: 'Rotterdam', debt: 0, total_debt: 0 },
];

const products = [
  { id: 1, name: 'دراجة كهربائية', category: 'دراجات', stock: 8, buy_price: 1100, sell_price: 1500, low_stock_threshold: 3 },
  { id: 2, name: 'إكسسوار', category: 'إكسسوارات', stock: 2, buy_price: 80, sell_price: 120, low_stock_threshold: 5 },
];

const invoices = [
  { id: 1, ref_code: 'INV-0001', date: '2026-05-01', client_name: 'أحمد المصري', client_phone: '0612345678', client_email: 'a@x.com', client_address: 'Amsterdam', item: 'دراجة كهربائية', quantity: 1, unit_price: 1500, total: 1500, payment_type: 'كاش', payment_status: 'مدفوع', vin: 'VIN-0001', seller_name: 'بائع', driver_name: 'سائق' },
];

const deliveries = [
  { id: 1, date: '2026-05-02', client_name: 'أحمد المصري', client_phone: '0612345678', address: 'Amsterdam', items: 'دراجة كهربائية', total_amount: 1500, status: 'قيد الانتظار', assigned_driver: 'driver1', driver_name: 'سائق تجريبي', vin: 'VIN-0001' },
  { id: 2, date: '2026-05-04', client_name: 'سارة علي', client_phone: '0698765432', address: 'Rotterdam', items: 'إكسسوار', total_amount: 240, status: 'تم التوصيل', assigned_driver: 'driver1', driver_name: 'سائق تجريبي', vin: '' },
];

const expenses = [
  { id: 1, date: '2026-05-01', category: 'إيجار', description: 'إيجار المحل', amount: 800, payment_type: 'بنك', notes: '' },
  { id: 2, date: '2026-05-02', category: 'كهرباء', description: 'فاتورة كهرباء', amount: 120, payment_type: 'كاش', notes: 'شهري' },
];

const suppliers = [
  { id: 1, name: 'VoltBikes', phone: '0201112222', address: 'Den Haag', notes: '', debt: 500, total_debt: 500 },
  { id: 2, name: 'AccPro', phone: '0203334444', address: 'Utrecht', notes: '', debt: 0, total_debt: 0 },
];

const purchases = [
  { id: 1, date: '2026-04-20', supplier_name: 'VoltBikes', item: 'دراجة كهربائية', quantity: 5, unit_price: 1100, total: 5500, sell_price: 1500, payment_type: 'آجل', paid_amount: 5000, remaining: 500, ref_code: 'PUR-0001' },
];

const bonuses = [
  { id: 1, date: '2026-05-01', username: 'seller1', role: 'seller', total_bonus: 45, settled: false, sale_id: 1, sale_item: 'دراجة كهربائية', client_name: 'أحمد', recommended_price: 1450, actual_price: 1500, extra_bonus: 5 },
  { id: 2, date: '2026-05-03', username: 'seller1', role: 'seller', total_bonus: 12, settled: true, sale_id: 2, sale_item: 'إكسسوار', client_name: 'سارة', recommended_price: 240, actual_price: 240, extra_bonus: 0 },
];

const users = [
  { id: 1, name: 'مدير عام', username: 'admin', role: 'admin', active: true },
  { id: 2, name: 'بائع تجريبي', username: 'seller1', role: 'seller', active: true },
  { id: 3, name: 'سائق تجريبي', username: 'driver1', role: 'driver', active: true },
];

const settlements = [
  { id: 1, date: '2026-05-05', type: 'seller_payout', username: 'seller1', description: 'تسوية بائع — بائع تجريبي', amount: 45, settled_by: 'admin', notes: '' },
];

const settings = { vat_number: 'FR12345678901', iban: 'NL00BANK0123456789', bic: 'ABCDNL2A', vat_rate: '21', currency: 'EUR', treasury_enabled: 'true', shop_name: 'Vitesse Eco', shop_address: 'Amsterdam' };

const treasuryBoxes = {
  enabled: true,
  generalBoxId: 1,
  myBoxId: null,
  boxes: [
    { id: 1, type: 'main', balance: 12450, opening: 10000, owner_role: null, owner_username: null, owner_name: null },
    { id: 2, type: 'custody', balance: 320, opening: 0, owner_role: 'driver', owner_username: 'driver1', owner_name: 'سائق تجريبي' },
  ],
};

const profitDistributions = [
  { id: 1, period_from: '2026-04-01', period_to: '2026-04-30', base_amount: 1000, created_at: '2026-05-01', created_by: 'admin' },
];

// pathname (no query) → fixture
const MAP = {
  '/api/sales': sales,
  '/api/clients': clients,
  '/api/products': products,
  '/api/invoices': invoices,
  '/api/deliveries': deliveries,
  '/api/expenses': expenses,
  '/api/suppliers': suppliers,
  '/api/purchases': purchases,
  '/api/bonuses': bonuses,
  '/api/users': users,
  '/api/settlements': settlements,
  '/api/settings': settings,
  '/api/treasury/boxes': treasuryBoxes,
  '/api/treasury/handovers': [],
  '/api/treasury/movements': [
    { id: 3, date: '2026-05-04', kind: 'handover', signed_amount: -200, method: 'كاش', counterparty_box_id: 1, counterparty_type: 'main', counterparty_name: null, counterparty_username: null, created_by: 'driver1', notes: 'تسليم للصندوق العام', running_balance: 320 },
    { id: 2, date: '2026-05-02', kind: 'collection', signed_amount: 300, method: 'كاش', counterparty_box_id: null, created_by: 'driver1', notes: 'تحصيل من عميل', running_balance: 520 },
    { id: 1, date: '2026-05-01', kind: 'opening', signed_amount: 220, method: 'كاش', counterparty_box_id: null, created_by: 'admin', notes: 'رصيد افتتاحي', running_balance: 220 },
  ],
  '/api/treasury/capital': [],
  '/api/treasury/reconciliation': { available: false },
  '/api/profit-distributions': profitDistributions,
  '/api/profit-distributions/share-config': { mode: 'manual', shares: [] },
  '/api/profit-distributions/eligible-users': users.filter((u) => u.role !== 'driver'),
  '/api/profit-distributions/collected-revenue': { collected: 5000, distributed: 1000, remaining: 4000 },
  '/api/category-bonus-rates': [],
  '/api/users/bonus-rates': [],
  '/api/users/category-bonus-rates': [],
  '/api/users/eligible-for-settlement': [{ username: 'seller1', name: 'بائع تجريبي', available_credit: 45 }],
};

export function fixtureFor(urlString) {
  const { pathname } = new URL(urlString);
  if (Object.prototype.hasOwnProperty.call(MAP, pathname)) return MAP[pathname];
  return []; // unknown endpoint → empty list (page renders its empty state)
}
