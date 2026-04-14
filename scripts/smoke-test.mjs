#!/usr/bin/env node
/**
 * Pre-delivery smoke test — Phase 0 (API level)
 *
 * Executes 16 API-level scenarios against production via pure HTTP.
 * Authenticates via NextAuth credentials flow (admin/admin123).
 * Test data uses the `TEST` / `Test` prefix so it's easy to identify;
 * the DB will be TRUNCATED before v1.0 delivery anyway.
 *
 * No direct DB access — every verification is an API GET call. The
 * app's own routes surface enough state for full verification.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — env or auth failure (cannot run scenarios)
 *   2 — at least one assertion failed
 *
 * Output:
 *   - Live ✅/❌ output on stdout
 *   - JSON report written to docs/smoke-test-phase0-results.json
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://mohammadnl.vercel.app';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

// Test users for scenarios that need real seller+driver roles to trigger
// bonus insertion (admin role doesn't earn bonuses — see calculateBonusInTx).
const TEST_SELLER_USER = 'testseller';
const TEST_SELLER_PASS = 'testpass123';
const TEST_DRIVER_USER = 'testdriver';
const TEST_DRIVER_PASS = 'testpass123';

console.log(`[smoke] target: ${BASE_URL}`);

// ── Cookie jar ─────────────────────────────────────────────────
const cookieJar = new Map();

function cookieHeader() {
  if (cookieJar.size === 0) return '';
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function updateJarFromResponse(res) {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const firstPair = sc.split(';')[0];
    const eq = firstPair.indexOf('=');
    if (eq === -1) continue;
    const name = firstPair.slice(0, eq).trim();
    const value = firstPair.slice(eq + 1).trim();
    if (name && value) cookieJar.set(name, value);
  }
}

async function afetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && options.body && typeof options.body === 'string' && options.body.startsWith('{')) {
    headers['Content-Type'] = 'application/json';
  }
  const cookie = cookieHeader();
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  updateJarFromResponse(res);
  return res;
}

async function apiPost(path, body) {
  const res = await afetch(path, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function apiPut(path, body) {
  const res = await afetch(path, { method: 'PUT', body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function apiGet(path) {
  const res = await afetch(path);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// ── Results accumulator ────────────────────────────────────────
const results = [];
let currentScenario = null;

function assert(description, condition, details = {}) {
  const entry = {
    scenarioId: currentScenario,
    description,
    status: condition ? 'pass' : 'fail',
    details: condition ? undefined : details,
  };
  results.push(entry);
  const status = condition ? '✅' : '❌';
  const prefix = currentScenario ? `[${currentScenario}]` : '';
  console.log(`  ${status} ${prefix} ${description}`);
  if (!condition) console.log(`     ${JSON.stringify(details)}`);
  return condition;
}

function startScenario(id, title) {
  currentScenario = id;
  console.log(`\n━━━ Scenario ${id}: ${title} ━━━`);
}

// ── NextAuth login ─────────────────────────────────────────────
async function loginAs(username, password) {
  console.log(`\n━━━ Authenticating as ${username} ━━━`);

  cookieJar.clear();

  const csrfRes = await afetch('/api/auth/csrf');
  if (!csrfRes.ok) throw new Error(`CSRF fetch failed: ${csrfRes.status}`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  if (!csrfToken) throw new Error('No csrfToken in response');

  const body = new URLSearchParams({
    username,
    password,
    csrfToken,
    callbackUrl: BASE_URL,
    json: 'true',
  }).toString();

  const loginRes = await afetch('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const loginData = await loginRes.json().catch(() => ({}));
  if (loginData.error) throw new Error(`Login failed for ${username}: ${loginData.error}`);

  const sessRes = await afetch('/api/auth/session');
  const sess = await sessRes.json();
  if (!sess.user) throw new Error(`Session verification failed for ${username}: ${JSON.stringify(sess)}`);
  console.log(`  Logged in as: ${sess.user.username} (role: ${sess.user.role})`);
  return sess;
}

const login = () => loginAs(ADMIN_USER, ADMIN_PASS);

// Create test-seller + test-driver users if they don't already exist.
// Admin-only POST /api/users — duplicate-username errors are treated as
// success (the user is already there from a previous run).
async function ensureTestUsers() {
  console.log('\n━━━ Ensuring test-seller + test-driver users exist ━━━');

  const seller = await apiPost('/api/users', {
    username: TEST_SELLER_USER,
    password: TEST_SELLER_PASS,
    name: 'Test Seller',
    role: 'seller',
  });
  if (seller.res.ok || /موجود/.test(seller.data?.error || '')) {
    console.log(`  ${TEST_SELLER_USER} ready (status ${seller.res.status})`);
  } else {
    throw new Error(`Failed to create ${TEST_SELLER_USER}: ${JSON.stringify(seller.data)}`);
  }

  const driver = await apiPost('/api/users', {
    username: TEST_DRIVER_USER,
    password: TEST_DRIVER_PASS,
    name: 'Test Driver',
    role: 'driver',
  });
  if (driver.res.ok || /موجود/.test(driver.data?.error || '')) {
    console.log(`  ${TEST_DRIVER_USER} ready (status ${driver.res.status})`);
  } else {
    throw new Error(`Failed to create ${TEST_DRIVER_USER}: ${JSON.stringify(driver.data)}`);
  }
}

// ── Helpers for API-only state verification ────────────────────
async function getSaleById(id) {
  const { data } = await apiGet('/api/sales');
  if (!Array.isArray(data)) return null;
  return data.find((s) => s.id === id) || null;
}

async function getProductStock(name) {
  const { data } = await apiGet('/api/products');
  if (!Array.isArray(data)) return null;
  const p = data.find((x) => x.name === name);
  return p ? Number(p.stock) : null;
}

async function getClientByName(name) {
  const { data } = await apiGet('/api/clients?withDebt=true');
  if (!Array.isArray(data)) return null;
  return data.find((c) => c.name === name) || null;
}

async function getPaymentsForSale(saleId, clientName) {
  // /api/payments doesn't have a sale_id filter — fetch by client and filter
  const { data } = await apiGet(`/api/payments?client=${encodeURIComponent(clientName)}`);
  if (!Array.isArray(data)) return [];
  return data.filter((p) => p.sale_id === saleId);
}

async function getBonusesForSale(saleId) {
  const { res, data } = await apiGet('/api/bonuses');
  if (!res.ok || !Array.isArray(data)) return null; // endpoint may not exist / unauthorized
  return data.filter((b) => b.sale_id === saleId);
}

const TODAY = new Date().toISOString().split('T')[0];

// ── Scenarios ──────────────────────────────────────────────────

async function scenario1_entities() {
  startScenario('1', 'Create test entities (products, clients, supplier)');

  const p1 = await apiPost('/api/products', {
    name: 'TEST V20 Pro',
    category: 'دراجات كهربائية',
    buyPrice: 600,
    sellPrice: 950,
    stock: 10,
  });
  assert('POST /api/products TEST V20 Pro → 200', p1.res.ok, { status: p1.res.status, data: p1.data });

  const p2 = await apiPost('/api/products', {
    name: 'TEST V8 Ultra',
    category: 'دراجات كهربائية',
    buyPrice: 500,
    sellPrice: 800,
    stock: 10,
  });
  assert('POST /api/products TEST V8 Ultra → 200', p2.res.ok, { status: p2.res.status, data: p2.data });

  const c1 = await apiPost('/api/clients', {
    name: 'Ahmad Test',
    phone: '+31600001001',
    email: 'ahmad.test@example.test',
    address: '123 rue Test, 75001 Paris',
  });
  assert('POST /api/clients Ahmad Test → 200 (no ambiguous)', c1.res.ok && !c1.data.ambiguous, {
    status: c1.res.status,
    data: c1.data,
  });

  const c2 = await apiPost('/api/clients', {
    name: 'Ali Test',
    phone: '+31600001002',
    address: '456 avenue Test, 75002 Paris',
  });
  assert('POST /api/clients Ali Test → 200', c2.res.ok && !c2.data.ambiguous, {
    status: c2.res.status,
    data: c2.data,
  });

  const s1 = await apiPost('/api/suppliers', {
    name: 'Wahid Test',
    phone: '+31600002001',
  });
  assert('POST /api/suppliers Wahid Test → 200', s1.res.ok && !s1.data.ambiguous, {
    status: s1.res.status,
    data: s1.data,
  });

  // API verify: both products exist (stock may be residual from prior runs —
  // addProduct on existing name returns { exists: true } without resetting
  // stock, so we check existence, not absolute value)
  const stock1 = await getProductStock('TEST V20 Pro');
  assert('GET /api/products: TEST V20 Pro exists (stock ≥ 0)', stock1 !== null && stock1 >= 0, { actual: stock1 });
  const stock2 = await getProductStock('TEST V8 Ultra');
  assert('GET /api/products: TEST V8 Ultra exists (stock ≥ 0)', stock2 !== null && stock2 >= 0, { actual: stock2 });

  // Clients found with Latin names (BUG-5 check)
  const ahmad = await getClientByName('Ahmad Test');
  assert('GET /api/clients: Ahmad Test exists (Latin)', !!ahmad, { found: ahmad?.name });
  const ali = await getClientByName('Ali Test');
  assert('GET /api/clients: Ali Test exists (Latin)', !!ali, { found: ali?.name });

  return {
    ahmadId: ahmad?.id,
    aliId: ali?.id,
    initialStockV20Pro: stock1,
    initialStockV8Ultra: stock2,
  };
}

async function scenario2_cashSale(ctx) {
  startScenario('2', 'Admin creates cash sale (full payment)');

  const { res, data } = await apiPost('/api/sales', {
    date: TODAY,
    clientName: 'Ahmad Test',
    clientPhone: '+31600001001',
    clientAddress: '123 rue Test, 75001 Paris',
    item: 'TEST V20 Pro',
    quantity: 1,
    unitPrice: 950,
    paymentType: 'كاش',
    downPaymentExpected: 950,
  });
  assert('POST /api/sales cash → 200 with id', res.ok && data.id, { status: res.status, data });
  if (!data.id) return null;

  const sale = await getSaleById(data.id);
  assert('GET /api/sales: sale.status = محجوز', sale?.status === 'محجوز', { actual: sale?.status });
  assert('GET /api/sales: payment_status = pending', sale?.payment_status === 'pending', {
    actual: sale?.payment_status,
  });
  assert(
    'GET /api/sales: down_payment_expected = 950',
    Number(sale?.down_payment_expected) === 950,
    { actual: sale?.down_payment_expected }
  );

  const stock = await getProductStock('TEST V20 Pro');
  assert('GET /api/products: stock decremented by 1 after cash sale', stock === ctx.initialStockV20Pro - 1, {
    before: ctx.initialStockV20Pro,
    after: stock,
  });

  return data.id;
}

async function scenario3_creditSale(ctx) {
  startScenario('3', 'Admin creates credit sale (آجل, dpe=0)');

  const { res, data } = await apiPost('/api/sales', {
    date: TODAY,
    clientName: 'Ahmad Test',
    clientPhone: '+31600001001',
    clientAddress: '123 rue Test, 75001 Paris',
    item: 'TEST V20 Pro',
    quantity: 1,
    unitPrice: 950,
    paymentType: 'آجل',
    downPaymentExpected: 0,
  });
  assert('POST /api/sales credit → 200', res.ok && data.id, { status: res.status, data });
  if (!data.id) return null;

  const sale = await getSaleById(data.id);
  assert('GET /api/sales: credit sale dpe = 0', Number(sale?.down_payment_expected) === 0, {
    actual: sale?.down_payment_expected,
  });
  assert('GET /api/sales: payment_type = آجل', sale?.payment_type === 'آجل');

  const stock = await getProductStock('TEST V20 Pro');
  assert('GET /api/products: stock decremented by 1 more after credit sale', stock === ctx.initialStockV20Pro - 2, {
    before: ctx.initialStockV20Pro,
    after: stock,
  });

  return data.id;
}

async function scenario4_mixedSale() {
  startScenario('4', 'Admin creates mixed sale (cash with partial dpe=300)');

  const { res, data } = await apiPost('/api/sales', {
    date: TODAY,
    clientName: 'Ali Test',
    clientPhone: '+31600001002',
    clientAddress: '456 avenue Test, 75002 Paris',
    item: 'TEST V8 Ultra',
    quantity: 1,
    unitPrice: 900,
    paymentType: 'كاش',
    downPaymentExpected: 300,
  });
  assert('POST /api/sales mixed dpe=300 → 200', res.ok && data.id, { status: res.status, data });
  if (!data.id) return null;

  const sale = await getSaleById(data.id);
  assert(
    'GET /api/sales: mixed sale dpe = 300',
    Number(sale?.down_payment_expected) === 300,
    { actual: sale?.down_payment_expected }
  );
  assert('GET /api/sales: total = 900', Number(sale?.total) === 900);

  return data.id;
}

async function confirmDelivery(saleId, vin, assignedDriver = 'admin') {
  // Find the delivery row for this sale via GET /api/deliveries
  const { data: deliveries } = await apiGet('/api/deliveries');
  if (!Array.isArray(deliveries)) return { ok: false, error: 'deliveries list unavailable' };
  const delivery = deliveries.find((d) => d.sale_id === saleId);
  if (!delivery) return { ok: false, error: `no delivery for sale ${saleId}` };

  const { res, data } = await apiPut('/api/deliveries', {
    id: delivery.id,
    date: delivery.date,
    clientName: delivery.client_name,
    clientPhone: delivery.client_phone || '',
    address: delivery.address || '',
    items: delivery.items,
    totalAmount: Number(delivery.total_amount) || 0,
    status: 'تم التوصيل',
    driverName: assignedDriver === TEST_DRIVER_USER ? 'Test Driver' : 'Test Driver',
    assignedDriver,
    notes: delivery.notes || '',
    vin,
  });
  return { ok: res.ok, status: res.status, data };
}

async function scenario5_confirmCashDelivery(saleId) {
  startScenario('5', 'Confirm delivery on cash sale (full dpe → payment row + paid)');

  const result = await confirmDelivery(saleId, 'TESTVIN-S5');
  assert('PUT /api/deliveries confirm → 200', result.ok, { result });

  const sale = await getSaleById(saleId);
  assert('GET /api/sales: sale.status = مؤكد', sale?.status === 'مؤكد');
  assert('GET /api/sales: payment_status = paid', sale?.payment_status === 'paid', {
    actual: sale?.payment_status,
  });
  assert('GET /api/sales: remaining = 0', Number(sale?.remaining) === 0, { actual: sale?.remaining });

  // Verify a collection payment row exists for this sale
  const payments = await getPaymentsForSale(saleId, 'Ahmad Test');
  const collections = payments.filter((p) => p.type === 'collection');
  assert('GET /api/payments: 1 collection row for sale', collections.length === 1, {
    count: collections.length,
  });
  if (collections.length > 0) {
    const p = collections[0];
    assert('Payment amount = 950', Number(p.amount) === 950, { actual: p.amount });
    assert('Payment method = كاش', p.payment_method === 'كاش');
    const tva = Number(p.tva_amount);
    assert('Payment tva ≈ 158.33 (amount/6)', Math.abs(tva - 158.33) < 0.1, { actual: tva });
  }
}

async function scenario6_confirmPartialDelivery(saleId) {
  startScenario('6', 'Confirm delivery on mixed sale (dpe=300 → partial + payment row)');

  const result = await confirmDelivery(saleId, 'TESTVIN-S6');
  assert('PUT /api/deliveries confirm partial → 200', result.ok, { result });

  const sale = await getSaleById(saleId);
  assert('GET /api/sales: payment_status = partial', sale?.payment_status === 'partial', {
    actual: sale?.payment_status,
  });
  assert('GET /api/sales: paid_amount = 300', Number(sale?.paid_amount) === 300, { actual: sale?.paid_amount });
  assert('GET /api/sales: remaining = 600', Number(sale?.remaining) === 600, { actual: sale?.remaining });

  const payments = await getPaymentsForSale(saleId, 'Ali Test');
  const collections = payments.filter((p) => p.type === 'collection');
  assert('GET /api/payments: 1 collection row for mixed sale', collections.length === 1, {
    count: collections.length,
  });
  if (collections.length > 0) {
    assert('Payment amount = 300 (dpe)', Number(collections[0].amount) === 300);
    const tva = Number(collections[0].tva_amount);
    assert('Payment tva ≈ 50 (300/6)', Math.abs(tva - 50) < 0.1, { actual: tva });
  }
}

async function confirmCreditSaleReadyForFIFO(creditSaleId) {
  // Confirm the credit sale's delivery so it becomes eligible for FIFO collection.
  // The FIFO walker in applyCollectionFIFO requires sales with status='مؤكد'.
  // Credit sale has dpe=0 so no payment row is written — just a status change.
  startScenario('7.5', 'Pre-flight: confirm credit sale delivery for FIFO eligibility');
  const result = await confirmDelivery(creditSaleId, 'TESTVIN-S3-PREFIFO');
  assert('PUT /api/deliveries confirm credit sale → 200', result.ok, { result });

  const sale = await getSaleById(creditSaleId);
  assert('Credit sale now مؤكد', sale?.status === 'مؤكد', { actual: sale?.status });
  assert('Credit sale payment_status = partial (remaining = 950 > 0)', sale?.payment_status === 'partial', {
    actual: sale?.payment_status,
  });
}

async function scenario8_fifoCollection(ctx, creditSaleId) {
  startScenario('8', 'FIFO collection walker for Ahmad Test (target credit sale 950)');

  if (!ctx.ahmadId) {
    assert('Skipped — ahmadId missing', false);
    return;
  }

  const { res, data } = await apiPost(`/api/clients/${ctx.ahmadId}/collect`, {
    amount: 950,
    paymentMethod: 'كاش',
  });
  assert('POST /api/clients/[id]/collect (FIFO) → 200', res.ok, { status: res.status, data });
  assert('Response has applied array', Array.isArray(data.applied), {
    dataShape: Object.keys(data || {}),
  });

  const sale = await getSaleById(creditSaleId);
  assert('GET /api/sales: credit sale payment_status = paid', sale?.payment_status === 'paid', {
    actual: sale?.payment_status,
  });
  assert('GET /api/sales: credit sale remaining = 0', Number(sale?.remaining) === 0);

  const payments = await getPaymentsForSale(creditSaleId, 'Ahmad Test');
  const collections = payments.filter((p) => p.type === 'collection');
  assert('GET /api/payments: 1 collection row for credit sale', collections.length === 1, {
    count: collections.length,
  });
  if (collections.length > 0) {
    assert('FIFO collection method = كاش', collections[0].payment_method === 'كاش');
  }
}

async function scenario9_specificSaleCollection(saleId) {
  startScenario('9', 'Specific-sale collection (bank method, mixed sale remaining 600)');

  const { res, data } = await apiPost(`/api/sales/${saleId}/collect`, {
    amount: 600,
    paymentMethod: 'بنك',
  });
  assert('POST /api/sales/[id]/collect → 200', res.ok, { status: res.status, data });

  const sale = await getSaleById(saleId);
  assert('GET /api/sales: mixed sale now paid', sale?.payment_status === 'paid', {
    actual: sale?.payment_status,
  });
  assert('GET /api/sales: mixed sale remaining = 0', Number(sale?.remaining) === 0);

  // Should now have 2 collection rows: dpe at delivery + this 600 bank
  const payments = await getPaymentsForSale(saleId, 'Ali Test');
  const collections = payments.filter((p) => p.type === 'collection');
  assert('GET /api/payments: 2 collection rows for mixed sale', collections.length === 2, {
    count: collections.length,
  });
  const bankRow = collections.find((p) => p.payment_method === 'بنك');
  assert('Bank collection row exists with amount 600', bankRow && Number(bankRow.amount) === 600);
}

async function scenario10_overpayRejection(fullyPaidSaleId) {
  startScenario('10', 'Overpay rejection on already-paid sale');

  const { res, data } = await apiPost(`/api/sales/${fullyPaidSaleId}/collect`, {
    amount: 100,
    paymentMethod: 'كاش',
  });
  assert('POST /api/sales/[id]/collect on paid sale → 400', res.status === 400, {
    status: res.status,
    data,
  });
  assert('Response has Arabic error message', typeof data.error === 'string' && /[\u0600-\u06FF]/.test(data.error), {
    error: data.error,
  });
}

async function scenario11_cancelReserved() {
  startScenario('11', 'Cancel reserved sale (no bonuses, no refund)');

  const { data: saleData } = await apiPost('/api/sales', {
    date: TODAY,
    clientName: 'Ahmad Test',
    clientPhone: '+31600001001',
    clientAddress: '123 rue Test, 75001 Paris',
    item: 'TEST V20 Pro',
    quantity: 1,
    unitPrice: 950,
    paymentType: 'كاش',
    downPaymentExpected: 950,
  });
  const saleId = saleData.id;
  if (!saleId) {
    assert('Seed reserved sale', false, { saleData });
    return;
  }

  const stockBefore = await getProductStock('TEST V20 Pro');

  const { res: previewRes, data: previewData } = await apiGet(`/api/sales/${saleId}/cancel`);
  assert('GET preview cancel → 200', previewRes.ok, { status: previewRes.status, data: previewData });
  assert(
    'Preview refundAmount = 0 (no payment, reserved)',
    Number(previewData.refundAmount || 0) === 0,
    { refundAmount: previewData.refundAmount }
  );

  const { res, data } = await apiPost(`/api/sales/${saleId}/cancel`, {
    reason: 'TEST 11 — reserved cancel',
    invoiceMode: 'soft',
    bonusActions: null,
  });
  assert('POST cancel reserved → 200', res.ok, { status: res.status, data });

  const stockAfter = await getProductStock('TEST V20 Pro');
  assert('Stock restored after cancel', stockAfter === (stockBefore || 0) + 1, {
    before: stockBefore,
    after: stockAfter,
  });

  const sale = await getSaleById(saleId);
  assert('Sale status = ملغي', sale?.status === 'ملغي');
  assert('Sale payment_status = cancelled', sale?.payment_status === 'cancelled');
}

// Create a confirmed sale attributed to test-seller/test-driver so that
// bonuses are actually inserted (calculateBonusInTx requires role=seller
// on the creator and role=driver on the assigned driver). Returns the
// new sale id. The caller is responsible for the final login state —
// this helper leaves the cookie jar on admin when it returns.
async function seedConfirmedSaleWithBonuses(vinTag) {
  // 1. Log in as test-seller to create the sale (so created_by=testseller)
  await loginAs(TEST_SELLER_USER, TEST_SELLER_PASS);
  const { data: saleData } = await apiPost('/api/sales', {
    date: TODAY,
    clientName: 'Ahmad Test',
    clientPhone: '+31600001001',
    clientAddress: '123 rue Test, 75001 Paris',
    item: 'TEST V20 Pro',
    quantity: 1,
    unitPrice: 950,
    paymentType: 'كاش',
    downPaymentExpected: 950,
  });
  const saleId = saleData?.id;

  // 2. Switch back to admin for delivery confirmation + bonus calculation.
  await loginAs(ADMIN_USER, ADMIN_PASS);
  if (!saleId) return null;

  await confirmDelivery(saleId, vinTag, TEST_DRIVER_USER);
  return saleId;
}

async function scenario12_cancelKeepBonus() {
  startScenario('12', 'Cancel confirmed sale + keep bonuses (seeded as testseller+testdriver)');

  const saleId = await seedConfirmedSaleWithBonuses('TESTVIN-S12');
  if (!saleId) {
    assert('Seed confirmed sale for S12', false);
    return;
  }

  const bonusPre = await getBonusesForSale(saleId);
  if (bonusPre === null) {
    assert('GET /api/bonuses available', false, { note: 'endpoint unreachable' });
    return;
  }
  assert('Pre-cancel: bonus rows exist (seller + driver)', bonusPre.length === 2, { count: bonusPre.length });

  const { res } = await apiPost(`/api/sales/${saleId}/cancel`, {
    reason: 'TEST 12 — keep bonuses',
    invoiceMode: 'soft',
    bonusActions: { seller: 'keep', driver: 'keep' },
  });
  assert('POST cancel keep → 200', res.ok, { status: res.status });

  // Verify refund row (negative amount in payments)
  const payments = await getPaymentsForSale(saleId, 'Ahmad Test');
  const refunds = payments.filter((p) => p.type === 'refund');
  assert('Refund row inserted', refunds.length === 1, { count: refunds.length });
  if (refunds.length > 0) {
    assert('Refund amount is negative', Number(refunds[0].amount) < 0, { amount: refunds[0].amount });
  }

  // Bonuses should survive the keep-cancel
  const bonusPost = await getBonusesForSale(saleId);
  if (bonusPost !== null) {
    assert('Bonuses survive keep-cancel', bonusPost.length === bonusPre.length, {
      before: bonusPre.length,
      after: bonusPost.length,
    });
  }
}

async function scenario13_cancelRemoveBonus() {
  startScenario('13', 'Cancel confirmed sale + remove bonuses');

  const saleId = await seedConfirmedSaleWithBonuses('TESTVIN-S13');
  if (!saleId) {
    assert('Seed confirmed sale for S13', false);
    return;
  }

  const bonusPre = await getBonusesForSale(saleId);
  assert('Pre-cancel: bonus rows exist', bonusPre && bonusPre.length === 2, {
    count: bonusPre?.length,
  });

  const { res, data } = await apiPost(`/api/sales/${saleId}/cancel`, {
    reason: 'TEST 13 — remove bonuses',
    invoiceMode: 'soft',
    bonusActions: { seller: 'remove', driver: 'remove' },
  });
  assert('POST cancel remove → 200', res.ok, { status: res.status, data });

  const bonusAfter = await getBonusesForSale(saleId);
  if (bonusAfter !== null) {
    assert('Bonuses removed for cancelled sale', bonusAfter.length === 0, { after: bonusAfter.length });
  }

  const payments = await getPaymentsForSale(saleId, 'Ahmad Test');
  const refunds = payments.filter((p) => p.type === 'refund');
  assert('Refund row inserted', refunds.length === 1);
}

async function scenario14_settledBonusBlock() {
  startScenario('14', 'BUG-22 settled bonus protection blocks cancel');

  const saleId = await seedConfirmedSaleWithBonuses('TESTVIN-S14');
  if (!saleId) {
    assert('Seed confirmed sale for S14', false);
    return;
  }

  // Verify bonuses exist
  const bonuses = await getBonusesForSale(saleId);
  if (!bonuses || bonuses.length === 0) {
    assert('Bonus rows exist for S14 (testseller+testdriver)', false, { bonuses });
    return;
  }
  const sellerBonus = bonuses.find((b) => b.role === 'seller');
  assert('Seller bonus exists for S14', !!sellerBonus, { bonuses });
  if (!sellerBonus) return;

  // Settle testseller's seller bonuses via POST /api/settlements.
  // addSettlement walks unsettled bonuses FIFO by id ASC. Earlier scenarios
  // (S12 kept its bonuses on cancel) may have left lingering unsettled rows
  // for testseller. Sending a large amount guarantees EVERY unsettled
  // testseller bonus — including S14's — gets marked settled, even though
  // the loop starts from the oldest.
  const settleRes = await apiPost('/api/settlements', {
    date: TODAY,
    type: 'seller_payout',
    username: TEST_SELLER_USER,
    description: 'TEST 14 — settle all testseller bonuses to trigger BUG-22',
    amount: 1000,
  });
  assert('POST /api/settlements → 200 (marks bonuses settled)', settleRes.res.ok, {
    status: settleRes.res.status,
    data: settleRes.data,
  });

  // Attempt to cancel with remove → should fail per BUG-22 protection
  const { res, data } = await apiPost(`/api/sales/${saleId}/cancel`, {
    reason: 'TEST 14 — settled block',
    invoiceMode: 'soft',
    bonusActions: { seller: 'remove', driver: 'remove' },
  });
  assert('POST cancel with settled bonus → rejected (not 200)', !res.ok, {
    status: res.status,
    data,
  });
  assert(
    'Response has error/message field',
    typeof (data.error || data.message || data.code) === 'string',
    { error: data.error, message: data.message, code: data.code }
  );

  // Sale should still be confirmed
  const sale = await getSaleById(saleId);
  assert('Sale still مؤكد (cancel blocked)', sale?.status === 'مؤكد', { actual: sale?.status });
}

async function scenario18_19_20_dashboard() {
  const { res, data } = await apiGet(`/api/summary?from=${TODAY}&to=${TODAY}`);

  startScenario('18', 'Dashboard dual-view P&L (accrual + cash-basis)');
  assert('GET /api/summary → 200', res.ok, { status: res.status });
  assert('Response has totalRevenueAccrued', typeof data.totalRevenueAccrued === 'number');
  assert('Response has totalRevenueCashBasis', typeof data.totalRevenueCashBasis === 'number');
  assert('Response has netProfitCashBasis', typeof data.netProfitCashBasis === 'number');
  assert('Response has grossProfitCashBasis', typeof data.grossProfitCashBasis === 'number');
  assert('Response has pendingRevenue', typeof data.pendingRevenue === 'number');
  assert('Response has pendingTva', typeof data.pendingTva === 'number');
  assert('Response has paidSalesCount', typeof data.paidSalesCount === 'number');
  assert('Response has partialSalesCount', typeof data.partialSalesCount === 'number');

  startScenario('19', 'Pending collections widget arithmetic');
  const expectedTva = data.pendingRevenue / 6;
  assert(
    'pendingTva ≈ pendingRevenue / 6',
    Math.abs(data.pendingTva - expectedTva) < 0.1,
    { pendingRevenue: data.pendingRevenue, pendingTva: data.pendingTva, expected: expectedTva }
  );
  assert('paidSalesCount ≥ 0 (structural)', data.paidSalesCount >= 0, { actual: data.paidSalesCount });
  assert('partialSalesCount ≥ 0 (structural)', data.partialSalesCount >= 0, {
    actual: data.partialSalesCount,
  });

  startScenario('20', 'P&L arithmetic cross-check (gross = revenue − COGS in both views)');
  const accrualGross = data.totalRevenue - data.totalCOGS;
  assert(
    'accrual: grossProfit = totalRevenue − totalCOGS',
    Math.abs(accrualGross - data.grossProfit) < 0.01,
    { computed: accrualGross, reported: data.grossProfit }
  );
  const cashGross = data.totalRevenueCashBasis - data.totalCOGSCashBasis;
  assert(
    'cash-basis: grossProfit = totalRevenueCashBasis − totalCOGSCashBasis',
    Math.abs(cashGross - data.grossProfitCashBasis) < 0.01,
    { computed: cashGross, reported: data.grossProfitCashBasis }
  );
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  try {
    await login();
  } catch (err) {
    console.error('\n❌ Authentication failed:', err.message);
    process.exit(1);
  }

  try {
    await ensureTestUsers();
  } catch (err) {
    console.error('\n❌ Test user creation failed:', err.message);
    process.exit(1);
  }

  let ctx;
  try {
    ctx = await scenario1_entities();
  } catch (err) {
    console.error('\n❌ Scenario 1 threw:', err.message);
    process.exit(2);
  }

  let cashSaleId, creditSaleId, mixedSaleId;
  try {
    cashSaleId = await scenario2_cashSale(ctx);
  } catch (err) {
    console.error('\n❌ Scenario 2 threw:', err.message);
  }
  try {
    creditSaleId = await scenario3_creditSale(ctx);
  } catch (err) {
    console.error('\n❌ Scenario 3 threw:', err.message);
  }
  try {
    mixedSaleId = await scenario4_mixedSale();
  } catch (err) {
    console.error('\n❌ Scenario 4 threw:', err.message);
  }

  try {
    if (cashSaleId) await scenario5_confirmCashDelivery(cashSaleId);
  } catch (err) {
    console.error('\n❌ Scenario 5 threw:', err.message);
  }
  try {
    if (mixedSaleId) await scenario6_confirmPartialDelivery(mixedSaleId);
  } catch (err) {
    console.error('\n❌ Scenario 6 threw:', err.message);
  }

  try {
    // S8 requires the credit sale to be مؤكد; confirm its delivery first
    if (creditSaleId) await confirmCreditSaleReadyForFIFO(creditSaleId);
  } catch (err) {
    console.error('\n❌ Scenario 7.5 (pre-FIFO confirm) threw:', err.message);
  }
  try {
    if (creditSaleId) await scenario8_fifoCollection(ctx, creditSaleId);
  } catch (err) {
    console.error('\n❌ Scenario 8 threw:', err.message);
  }
  try {
    if (mixedSaleId) await scenario9_specificSaleCollection(mixedSaleId);
  } catch (err) {
    console.error('\n❌ Scenario 9 threw:', err.message);
  }
  try {
    if (cashSaleId) await scenario10_overpayRejection(cashSaleId);
  } catch (err) {
    console.error('\n❌ Scenario 10 threw:', err.message);
  }

  try {
    await scenario11_cancelReserved();
  } catch (err) {
    console.error('\n❌ Scenario 11 threw:', err.message);
  }
  try {
    await scenario12_cancelKeepBonus();
  } catch (err) {
    console.error('\n❌ Scenario 12 threw:', err.message);
  }
  try {
    await scenario13_cancelRemoveBonus();
  } catch (err) {
    console.error('\n❌ Scenario 13 threw:', err.message);
  }
  try {
    await scenario14_settledBonusBlock();
  } catch (err) {
    console.error('\n❌ Scenario 14 threw:', err.message);
  }

  try {
    await scenario18_19_20_dashboard();
  } catch (err) {
    console.error('\n❌ Dashboard scenarios threw:', err.message);
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total assertions: ${results.length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (failed > 0) {
    console.log('\nFailed assertions:');
    for (const r of results.filter((r) => r.status === 'fail')) {
      console.log(`  ❌ [${r.scenarioId}] ${r.description}`);
      console.log(`     ${JSON.stringify(r.details)}`);
    }
  }

  const resultsDir = resolve(repoRoot, 'docs');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const reportPath = resolve(resultsDir, 'smoke-test-phase0-results.json');
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        base_url: BASE_URL,
        total: results.length,
        passed,
        failed,
        results,
      },
      null,
      2
    )
  );
  console.log(`\nReport written to: ${reportPath}`);

  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
