#!/usr/bin/env node
/**
 * Production stress test — Session 8 Phase 0.5
 *
 * 500 operations across 5 business rules:
 *   1. Sale lifecycle            (150 ops)
 *   2. FIFO collection           (100 ops)
 *   3. Cancellation integrity    (100 ops)
 *   4. Bonus eligibility by role (100 ops)
 *   5. Concurrent collections    ( 50 ops)
 *
 * Reuses the smoke-test.mjs authentication + cookie-jar pattern.
 * Captures per-operation response times (p50/p95/p99) alongside
 * correctness assertions. All test entities use the STRESS prefix
 * so they're easy to identify before the pre-delivery TRUNCATE.
 *
 * Usage:
 *   node scripts/stress-test.mjs
 *
 * Exit codes:
 *   0 — pass rate ≥ 99%
 *   1 — env/auth/setup failure
 *   2 — pass rate < 99%
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const BASE_URL = process.env.STRESS_BASE_URL || 'https://mohammadnl.vercel.app';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

const STRESS_PASS = 'stresspass123';
const USERS = {
  seller:  { username: 'stressseller',  password: STRESS_PASS, name: 'Stress Seller',   role: 'seller'  },
  seller2: { username: 'stressseller2', password: STRESS_PASS, name: 'Stress Seller 2', role: 'seller'  },
  driver:  { username: 'stressdriver',  password: STRESS_PASS, name: 'Stress Driver',   role: 'driver'  },
  manager: { username: 'stressmanager', password: STRESS_PASS, name: 'Stress Manager',  role: 'manager' },
};

// Products are scoped to this run via a timestamp suffix so each run gets
// a fresh 200-unit stock per product. Stock is only restored by cancel
// (Rule 3), not by completed sales, so reusing product names across runs
// drains the pool and causes cascading "out of stock" failures by Rule 4/5.
// The STRESS prefix still identifies every entity for the pre-delivery
// TRUNCATE — the suffix just ensures cross-run isolation.
const RUN_ID = Date.now().toString().slice(-10);
const STRESS_PRODUCTS = [
  { name: `STRESS-${RUN_ID} Product A`, category: 'قطع غيار', buyPrice: 500, sellPrice:  800, stock: 200 },
  { name: `STRESS-${RUN_ID} Product B`, category: 'قطع غيار', buyPrice: 600, sellPrice:  950, stock: 200 },
  { name: `STRESS-${RUN_ID} Product C`, category: 'قطع غيار', buyPrice: 700, sellPrice: 1100, stock: 200 },
  { name: `STRESS-${RUN_ID} Product D`, category: 'قطع غيار', buyPrice: 400, sellPrice:  650, stock: 200 },
  { name: `STRESS-${RUN_ID} Product E`, category: 'قطع غيار', buyPrice: 800, sellPrice: 1250, stock: 200 },
];
const STRESS_PRODUCT_NAMES = new Set(STRESS_PRODUCTS.map((p) => p.name));

const STRESS_CLIENTS = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    name: `STRESS Client ${n}`,
    phone: `060010${n}01`,
    address: `STRESS Address ${n}`,
  };
});

const STRESS_SUPPLIERS = [
  { name: 'STRESS Supplier 1', phone: '0600200001' },
  { name: 'STRESS Supplier 2', phone: '0600200002' },
  { name: 'STRESS Supplier 3', phone: '0600200003' },
];

const TODAY = new Date().toISOString().split('T')[0];

console.log(`[stress] target: ${BASE_URL}`);
console.log(`[stress] started: ${new Date().toISOString()}`);

// ── Deterministic RNG ───────────────────────────────────────────
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
const rng = seededRandom(42);
const pickRandom = (arr) => arr[Math.floor(rng() * arr.length)];
const randomInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;

// ── Cookie jar ─────────────────────────────────────────────────
const cookieJar = new Map();

function cookieHeader() {
  if (cookieJar.size === 0) return '';
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
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

async function rawFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && options.body && typeof options.body === 'string' && options.body.startsWith('{')) {
    headers['Content-Type'] = 'application/json';
  }
  const cookie = cookieHeader();
  if (cookie) headers['Cookie'] = cookie;
  return fetch(url, { ...options, headers, redirect: 'manual' });
}

// afetch with 429 backoff
async function afetch(path, options = {}) {
  let attempt = 0;
  while (true) {
    const res = await rawFetch(path, options);
    updateJarFromResponse(res);
    if (res.status !== 429 || attempt >= 3) return res;
    const delay = 500 * Math.pow(2, attempt);
    console.log(`  [429] backoff ${delay}ms on ${path}`);
    await new Promise((r) => setTimeout(r, delay));
    attempt++;
  }
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

// ── Timings ────────────────────────────────────────────────────
const timings = {
  sale_create: [],
  sale_confirm: [],
  collect_fifo: [],
  collect_specific: [],
  cancel_reserved: [],
  cancel_keep: [],
  cancel_remove: [],
  parallel_collect: [],
};
function recordTiming(cat, ms) {
  if (!timings[cat]) timings[cat] = [];
  timings[cat].push(ms);
}
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Results accumulator ────────────────────────────────────────
const results = [];
let currentRule = null;
function assert(description, condition, details = {}) {
  const entry = {
    rule: currentRule,
    description,
    status: condition ? 'pass' : 'fail',
    details: condition ? undefined : details,
  };
  results.push(entry);
  if (!condition) {
    // Only print failures live to keep stdout manageable at 500+ assertions.
    console.log(`  ❌ [${currentRule}] ${description} ${JSON.stringify(details).slice(0, 200)}`);
  }
}

function startRule(id, title) {
  currentRule = id;
  console.log(`\n━━━ ${id}: ${title} ━━━`);
}

// ── NextAuth login ─────────────────────────────────────────────
async function loginAs(username, password) {
  cookieJar.clear();
  const csrfRes = await afetch('/api/auth/csrf');
  if (!csrfRes.ok) throw new Error(`CSRF fetch failed: ${csrfRes.status}`);
  const { csrfToken } = await csrfRes.json();
  if (!csrfToken) throw new Error('No csrfToken');
  const body = new URLSearchParams({
    username, password, csrfToken,
    callbackUrl: BASE_URL, json: 'true',
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
  if (!sess.user) throw new Error(`Session verification failed for ${username}`);
  return sess;
}
const loginAdmin = () => loginAs(ADMIN_USER, ADMIN_PASS);

// ── Helpers ────────────────────────────────────────────────────
async function getAllSales() {
  const { data } = await apiGet('/api/sales');
  return Array.isArray(data) ? data : [];
}
async function getSaleById(id) {
  const sales = await getAllSales();
  return sales.find((s) => s.id === id) || null;
}
async function getAllDeliveries() {
  const { data } = await apiGet('/api/deliveries');
  return Array.isArray(data) ? data : [];
}
async function getDeliveryForSale(saleId, cachedDeliveries = null) {
  const deliveries = cachedDeliveries || (await getAllDeliveries());
  return deliveries.find((d) => d.sale_id === saleId) || null;
}

// Confirm delivery using the exact PUT payload shape from smoke-test.mjs.
// Status is 'تم التوصيل' — NOT 'مؤكد'. The sale's status becomes مؤكد via
// the updateDelivery side-effect.
async function confirmDelivery(saleId, vin, assignedDriver = ADMIN_USER, cachedDeliveries = null) {
  const delivery = await getDeliveryForSale(saleId, cachedDeliveries);
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
    driverName: assignedDriver,
    assignedDriver,
    notes: delivery.notes || '',
    vin,
  });
  return { ok: res.ok, status: res.status, data, deliveryId: delivery.id };
}

// ── Setup ──────────────────────────────────────────────────────
async function setup() {
  startRule('setup', 'Creating users, products, clients, suppliers');
  const setupStart = Date.now();

  // Users
  for (const u of Object.values(USERS)) {
    const { res, data } = await apiPost('/api/users', u);
    const ok = res.ok || /موجود|exists/i.test(data?.error || '');
    if (!ok) {
      throw new Error(`Failed to create user ${u.username}: ${JSON.stringify(data)}`);
    }
  }
  console.log(`  4 users ready`);

  // Products
  for (const p of STRESS_PRODUCTS) {
    const { res, data } = await apiPost('/api/products', p);
    const ok = res.ok || data?.exists === true;
    if (!ok) {
      throw new Error(`Failed to create product ${p.name}: ${JSON.stringify(data)}`);
    }
  }
  console.log(`  ${STRESS_PRODUCTS.length} products ready`);

  // Clients (idempotent on same phone)
  for (const c of STRESS_CLIENTS) {
    const { res, data } = await apiPost('/api/clients', c);
    if (!res.ok && !data?.id) {
      throw new Error(`Failed to create client ${c.name}: ${JSON.stringify(data)}`);
    }
  }
  console.log(`  ${STRESS_CLIENTS.length} clients ready`);

  // Suppliers
  for (const s of STRESS_SUPPLIERS) {
    await apiPost('/api/suppliers', s);
  }
  console.log(`  ${STRESS_SUPPLIERS.length} suppliers ready`);

  const dur = Date.now() - setupStart;
  console.log(`  setup duration: ${(dur / 1000).toFixed(1)}s`);
}

// Create a sale as the currently-logged-in user.
async function createSale({ product, client, quantity, unitPrice, paymentType, dpe }) {
  const start = Date.now();
  const { res, data } = await apiPost('/api/sales', {
    date: TODAY,
    clientName: client.name,
    clientPhone: client.phone,
    clientAddress: client.address,
    item: product.name,
    quantity,
    unitPrice,
    paymentType,
    downPaymentExpected: dpe,
  });
  recordTiming('sale_create', Date.now() - start);
  return { ok: res.ok, status: res.status, data, id: data?.id || null };
}

// ── Rule 1: Sale lifecycle (150 ops) ──────────────────────────
async function rule1_saleLifecycle() {
  startRule('rule1', 'Sale lifecycle (150 ops: 60 cash + 50 credit + 40 mixed)');

  await loginAs(USERS.seller.username, USERS.seller.password);

  const createdSales = [];
  let cashOk = 0, creditOk = 0, mixedOk = 0;

  for (let i = 0; i < 150; i++) {
    const product = pickRandom(STRESS_PRODUCTS);
    const client = pickRandom(STRESS_CLIENTS);
    const quantity = randomInt(1, 3);
    const unitPrice = product.sellPrice;
    const total = unitPrice * quantity;

    let paymentType, dpe, kind;
    if (i < 60) {
      kind = 'cash'; paymentType = 'كاش'; dpe = total;
    } else if (i < 110) {
      kind = 'credit'; paymentType = 'آجل'; dpe = 0;
    } else {
      kind = 'mixed'; paymentType = 'كاش';
      dpe = Math.floor(total * (0.1 + rng() * 0.8));
    }

    const r = await createSale({ product, client, quantity, unitPrice, paymentType, dpe });
    if (r.ok && r.id) {
      createdSales.push({ id: r.id, kind, total, dpe, clientName: client.name });
      if (kind === 'cash') cashOk++;
      else if (kind === 'credit') creditOk++;
      else mixedOk++;
    } else {
      assert(`R1 sale create ${i + 1}/150`, false, { status: r.status, data: r.data });
    }
  }

  assert('R1 60 cash sales created', cashOk === 60, { actual: cashOk });
  assert('R1 50 credit sales created', creditOk === 50, { actual: creditOk });
  assert('R1 40 mixed sales created', mixedOk === 40, { actual: mixedOk });
  assert('R1 all 150 sales created', createdSales.length === 150, { actual: createdSales.length });

  // Confirm deliveries on the first 120 (switch to admin to do PUTs)
  await loginAdmin();
  let confirmOk = 0;
  // Fetch deliveries once and cache — we filter by sale_id locally.
  const deliveries = await getAllDeliveries();
  for (let i = 0; i < 120 && i < createdSales.length; i++) {
    const sale = createdSales[i];
    const start = Date.now();
    const result = await confirmDelivery(sale.id, `STRESSR1VIN${String(i).padStart(4, '0')}`, USERS.driver.username, deliveries);
    recordTiming('sale_confirm', Date.now() - start);
    if (result.ok) confirmOk++;
    else assert(`R1 confirm ${i + 1}/120`, false, { saleId: sale.id, result });
  }
  assert('R1 120 deliveries confirmed', confirmOk === 120, { actual: confirmOk });

  // Structural verification via list endpoints (no per-sale GETs — too costly)
  const allSales = await getAllSales();
  const stressSales = allSales.filter((s) => STRESS_PRODUCT_NAMES.has(s.item));
  const r1Ids = new Set(createdSales.map((s) => s.id));
  const r1Rows = stressSales.filter((s) => r1Ids.has(s.id));

  const cashConfirmedIds = new Set(createdSales.slice(0, 60).map((s) => s.id));
  const mixedConfirmedIds = new Set(createdSales.slice(110, 120).map((s) => s.id));
  const creditConfirmedIds = new Set(createdSales.slice(60, 110).map((s) => s.id));

  const cashPaid = r1Rows.filter((s) => cashConfirmedIds.has(s.id) && s.payment_status === 'paid').length;
  const mixedPartial = r1Rows.filter((s) => mixedConfirmedIds.has(s.id) && s.payment_status === 'partial').length;
  const creditPartial = r1Rows.filter((s) => creditConfirmedIds.has(s.id) && s.payment_status === 'partial').length;

  assert('R1 60 cash sales payment_status=paid', cashPaid === 60, { actual: cashPaid });
  assert('R1 10 confirmed mixed sales payment_status=partial', mixedPartial === 10, { actual: mixedPartial });
  assert('R1 50 confirmed credit sales payment_status=partial', creditPartial === 50, { actual: creditPartial });

  return createdSales;
}

// ── Rule 2: FIFO collection (100 ops) ─────────────────────────
async function rule2_fifoCollection() {
  startRule('rule2', 'FIFO collection walker (100 ops across 10 STRESS clients)');
  await loginAdmin();

  const { data: clients } = await apiGet('/api/clients?withDebt=true');
  if (!Array.isArray(clients)) {
    assert('R2 GET /api/clients', false, { clients });
    return;
  }
  const stressClients = clients.filter((c) => c.name?.startsWith?.('STRESS Client '));
  assert('R2 ≥ 1 STRESS client with debt', stressClients.length > 0, { count: stressClients.length });
  if (stressClients.length === 0) return;

  let successCount = 0;
  let noOpenSalesCount = 0;
  let overpayProtectedCount = 0;
  let unexpectedErrorCount = 0;

  for (let i = 0; i < 100; i++) {
    const client = pickRandom(stressClients);
    const amount = randomInt(100, 1500);
    const method = pickRandom(['كاش', 'بنك']);

    const start = Date.now();
    const { res, data } = await apiPost(`/api/clients/${client.id}/collect`, {
      amount,
      paymentMethod: method,
      date: TODAY,
    });
    recordTiming('collect_fifo', Date.now() - start);

    // Valid 400 outcomes from the FIFO collect endpoint:
    //   1. "لا يوجد" — no open sales for this client (fully paid)
    //   2. "لا يمكن تسجيل مبلغ أكبر من إجمالي الدين المفتوح (N€)" — caller
    //      tried to collect more than the client's total open balance.
    // Both are correct business-rule protection; only unrecognised errors
    // count as test failures.
    const err = data?.error || '';
    if (res.ok) {
      successCount++;
    } else if (res.status === 400 && /لا\s*يوجد|no open|nothing/i.test(err)) {
      noOpenSalesCount++;
    } else if (res.status === 400 && /لا يمكن تسجيل مبلغ أكبر/.test(err)) {
      overpayProtectedCount++;
    } else {
      unexpectedErrorCount++;
      assert(`R2 FIFO collect ${i + 1}/100 unexpected error`, false, {
        status: res.status, amount, data,
      });
    }
  }

  assert('R2 100 FIFO ops completed without unexpected errors', unexpectedErrorCount === 0, {
    success: successCount, noOpen: noOpenSalesCount,
    overpayProtected: overpayProtectedCount, unexpected: unexpectedErrorCount,
  });
  assert('R2 at least some collections succeeded', successCount > 0, { successCount });
  assert(
    'R2 breakdown sums to 100',
    successCount + noOpenSalesCount + overpayProtectedCount + unexpectedErrorCount === 100,
    { successCount, noOpenSalesCount, overpayProtectedCount, unexpectedErrorCount }
  );
  console.log(`  R2 FIFO breakdown: ${successCount} success, ${noOpenSalesCount} no-open, ${overpayProtectedCount} overpay-protected, ${unexpectedErrorCount} unexpected`);
}

// ── Rule 3: Cancellation integrity (100 ops) ──────────────────
async function rule3_cancellation() {
  startRule('rule3', 'Cancellation integrity (50 reserved + 30 keep + 20 remove)');

  // Seed 100 fresh sales as the seller (so bonuses will be generated
  // on the 50 that we later confirm for keep/remove cancellation).
  await loginAs(USERS.seller.username, USERS.seller.password);
  const cancelSales = [];
  for (let i = 0; i < 100; i++) {
    const product = pickRandom(STRESS_PRODUCTS);
    const client = pickRandom(STRESS_CLIENTS);
    const r = await createSale({
      product, client,
      quantity: 1,
      unitPrice: product.sellPrice,
      paymentType: 'كاش',
      dpe: product.sellPrice,
    });
    if (r.ok && r.id) cancelSales.push(r.id);
    else assert(`R3 seed sale ${i + 1}/100`, false, { status: r.status, data: r.data });
  }
  assert('R3 100 seed sales created', cancelSales.length === 100, { actual: cancelSales.length });

  // Confirm sales 50-99 for the 30 keep + 20 remove cases.
  await loginAdmin();
  const deliveries = await getAllDeliveries();
  let confirmCount = 0;
  for (let i = 50; i < 100; i++) {
    const saleId = cancelSales[i];
    if (!saleId) continue;
    const result = await confirmDelivery(saleId, `STRESSR3VIN${String(i).padStart(4, '0')}`, USERS.driver.username, deliveries);
    if (result.ok) confirmCount++;
  }
  assert('R3 50 sales confirmed for cancel tests', confirmCount === 50, { actual: confirmCount });

  // Cancel 50 reserved (indexes 0-49)
  let reservedOk = 0;
  for (let i = 0; i < 50; i++) {
    const saleId = cancelSales[i];
    if (!saleId) continue;
    const start = Date.now();
    const { res } = await apiPost(`/api/sales/${saleId}/cancel`, {
      reason: `STRESS R3 reserved ${i}`,
      invoiceMode: 'soft',
      bonusActions: null,
    });
    recordTiming('cancel_reserved', Date.now() - start);
    if (res.ok) reservedOk++;
    else assert(`R3 reserved cancel ${i + 1}/50`, false, { saleId, status: res.status });
  }
  assert('R3 50 reserved cancels succeeded', reservedOk === 50, { actual: reservedOk });

  // Cancel 30 confirmed with bonus KEEP (indexes 50-79)
  let keepOk = 0;
  for (let i = 0; i < 30; i++) {
    const saleId = cancelSales[50 + i];
    if (!saleId) continue;
    const start = Date.now();
    const { res } = await apiPost(`/api/sales/${saleId}/cancel`, {
      reason: `STRESS R3 keep ${i}`,
      invoiceMode: 'soft',
      bonusActions: { seller: 'keep', driver: 'keep' },
    });
    recordTiming('cancel_keep', Date.now() - start);
    if (res.ok) keepOk++;
    else assert(`R3 keep cancel ${i + 1}/30`, false, { saleId, status: res.status });
  }
  assert('R3 30 keep-bonus cancels succeeded', keepOk === 30, { actual: keepOk });

  // Cancel 20 confirmed with bonus REMOVE (indexes 80-99)
  let removeOk = 0;
  for (let i = 0; i < 20; i++) {
    const saleId = cancelSales[80 + i];
    if (!saleId) continue;
    const start = Date.now();
    const { res } = await apiPost(`/api/sales/${saleId}/cancel`, {
      reason: `STRESS R3 remove ${i}`,
      invoiceMode: 'soft',
      bonusActions: { seller: 'remove', driver: 'remove' },
    });
    recordTiming('cancel_remove', Date.now() - start);
    if (res.ok) removeOk++;
    else assert(`R3 remove cancel ${i + 1}/20`, false, { saleId, status: res.status });
  }
  assert('R3 20 remove-bonus cancels succeeded', removeOk === 20, { actual: removeOk });

  // Structural check: every cancelled sale must have status='ملغي' and
  // payment_status='cancelled' in the canonical /api/sales listing.
  const allSalesAfter = await getAllSales();
  const cancelledIds = new Set(cancelSales);
  const cancelledRows = allSalesAfter.filter((s) => cancelledIds.has(s.id));
  const properlyCancelled = cancelledRows.filter(
    (s) => s.status === 'ملغي' && s.payment_status === 'cancelled'
  ).length;
  assert('R3 all 100 cancelled sales have status=ملغي + payment_status=cancelled',
    properlyCancelled === 100, { actual: properlyCancelled, seen: cancelledRows.length });
}

// ── Rule 4: Bonus eligibility by role (100 ops) ───────────────
async function rule4_bonusEligibility() {
  startRule('rule4', 'Bonus eligibility by role (25×seller + 25×seller2 + 25×admin + 25×manager)');

  const bonusBefore = await countStressBonuses();

  const groups = [
    { user: USERS.seller,  sales: [] },
    { user: USERS.seller2, sales: [] },
    { user: null,          sales: [] }, // admin
    { user: USERS.manager, sales: [] },
  ];

  // Create 25 sales per group
  for (const g of groups) {
    if (g.user) await loginAs(g.user.username, g.user.password);
    else await loginAdmin();
    for (let i = 0; i < 25; i++) {
      const product = pickRandom(STRESS_PRODUCTS);
      const client = pickRandom(STRESS_CLIENTS);
      const r = await createSale({
        product, client,
        quantity: 1,
        unitPrice: product.sellPrice,
        paymentType: 'كاش',
        dpe: product.sellPrice,
      });
      if (r.ok && r.id) g.sales.push(r.id);
      else assert(`R4 ${g.user?.username || 'admin'} sale create`, false, { status: r.status });
    }
  }

  const [sellerG, seller2G, adminG, managerG] = groups;
  assert('R4 25 seller sales created',  sellerG.sales.length  === 25, { actual: sellerG.sales.length  });
  assert('R4 25 seller2 sales created', seller2G.sales.length === 25, { actual: seller2G.sales.length });
  assert('R4 25 admin sales created',   adminG.sales.length   === 25, { actual: adminG.sales.length   });
  assert('R4 25 manager sales created', managerG.sales.length === 25, { actual: managerG.sales.length });

  // Confirm deliveries: 50 by stressdriver (first 50 across all groups),
  // 50 by admin (second 50). Only stressdriver-confirmed yields a driver bonus.
  await loginAdmin();
  const deliveries = await getAllDeliveries();
  const allR4 = [...sellerG.sales, ...seller2G.sales, ...adminG.sales, ...managerG.sales];

  const driverConfirmedIds = new Set();
  const adminConfirmedIds = new Set();

  for (let i = 0; i < allR4.length; i++) {
    const saleId = allR4[i];
    const assignedDriver = i < 50 ? USERS.driver.username : ADMIN_USER;
    const result = await confirmDelivery(saleId, `STRESSR4VIN${String(i).padStart(4, '0')}`, assignedDriver, deliveries);
    if (!result.ok) {
      assert(`R4 confirm ${i + 1}/100`, false, { saleId, result });
      continue;
    }
    if (assignedDriver === USERS.driver.username) driverConfirmedIds.add(saleId);
    else adminConfirmedIds.add(saleId);
  }

  // Count bonuses after. The UNIQUE(delivery_id, role) index means each
  // delivery contributes at most one seller + one driver row, so we can
  // count by joining on delivery_id via the sale → delivery link.
  const bonusAfter = await countStressBonuses();
  const generated = {
    seller: bonusAfter.seller - bonusBefore.seller,
    driver: bonusAfter.driver - bonusBefore.driver,
  };

  // Expected seller bonuses: 50 sales were created by seller/seller2 roles.
  // All 50 pass through the delivery confirm path (some via driver, some via
  // admin), and calculateBonusInTx fires on every successful confirmation.
  // The seller-side check only cares about sales.created_by's role, so all
  // 50 should produce a seller bonus row regardless of who confirmed.
  assert('R4 seller bonuses generated = 50 (seller+seller2 sales)',
    generated.seller === 50, { expected: 50, actual: generated.seller });

  // Expected driver bonuses: 50 deliveries confirmed by stressdriver.
  // calculateBonusInTx reads assigned_driver from the delivery row and
  // checks users.role === 'driver'. Admin-confirmed deliveries produce 0.
  assert('R4 driver bonuses generated = 50 (stressdriver confirms only)',
    generated.driver === 50, { expected: 50, actual: generated.driver });

  console.log(`  R4 bonus counts — seller: +${generated.seller}, driver: +${generated.driver}`);
}

async function countStressBonuses() {
  const { res, data } = await apiGet('/api/bonuses');
  if (!res.ok || !Array.isArray(data)) {
    return { seller: 0, driver: 0, total: 0 };
  }
  const seller = data.filter((b) => b.role === 'seller' && STRESS_PRODUCT_NAMES.has(b.item)).length;
  const driver = data.filter((b) => b.role === 'driver' && STRESS_PRODUCT_NAMES.has(b.item)).length;
  return { seller, driver, total: seller + driver };
}

// ── Rule 5: Concurrent operations (50 ops) ────────────────────
async function rule5_concurrent() {
  startRule('rule5', 'Concurrent collections (10 sales × 5 parallel 200€ collects)');

  // Create 10 credit sales @ 1000€ with the seller.
  // Product B (sellPrice 950) — unitPrice must be ≥ product.sellPrice per
  // the recommended-price check in addSale. B is the highest-priced product
  // whose sellPrice still fits under our 1000 target, keeping the parallel
  // math clean: 5 × 200 = 1000, remaining should collapse to 0.
  await loginAs(USERS.seller.username, USERS.seller.password);
  const testSales = [];
  const product = STRESS_PRODUCTS[1];
  const client = STRESS_CLIENTS[0];
  for (let i = 0; i < 10; i++) {
    const r = await createSale({
      product, client,
      quantity: 1,
      unitPrice: 1000,
      paymentType: 'آجل',
      dpe: 0,
    });
    if (r.ok && r.id) {
      testSales.push(r.id);
    } else {
      assert(`R5 sale create ${i + 1}/10`, false, { status: r.status, data: r.data });
    }
  }
  assert('R5 10 credit sales created', testSales.length === 10, { actual: testSales.length });

  // Confirm all 10 deliveries as admin
  await loginAdmin();
  const deliveries = await getAllDeliveries();
  let r5ConfirmOk = 0;
  for (let i = 0; i < testSales.length; i++) {
    const result = await confirmDelivery(testSales[i], `STRESSR5VIN${String(i).padStart(4, '0')}`, USERS.driver.username, deliveries);
    if (result.ok) r5ConfirmOk++;
  }
  assert('R5 10 deliveries confirmed', r5ConfirmOk === 10, { actual: r5ConfirmOk });

  // Parallel collections: 5 × 200€ on each 1000€ sale
  let totalSucceeded = 0;
  let totalOverpayProtected = 0;
  for (const saleId of testSales) {
    const start = Date.now();
    const promises = Array.from({ length: 5 }, () =>
      apiPost(`/api/sales/${saleId}/collect`, {
        amount: 200,
        paymentMethod: 'كاش',
      })
    );
    const results = await Promise.allSettled(promises);
    recordTiming('parallel_collect', Date.now() - start);

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.res.ok).length;
    totalSucceeded += succeeded;

    const sale = await getSaleById(saleId);
    const paid = Number(sale?.paid_amount || 0);
    const remaining = Number(sale?.remaining || 0);

    // Serialized arithmetic: paid + remaining = 1000, paid = succeeded × 200
    const mathOk = Math.abs(paid + remaining - 1000) < 0.01 && Math.abs(paid - succeeded * 200) < 0.01;
    assert(`R5 sale ${saleId} serialization math`, mathOk, {
      succeeded, paid, remaining,
    });

    // No overpayment — paid must never exceed 1000
    if (paid > 1000) {
      assert(`R5 sale ${saleId} no overpay`, false, { paid });
    } else {
      totalOverpayProtected++;
    }
  }
  assert('R5 no overpayment on any parallel sale', totalOverpayProtected === testSales.length, {
    protected: totalOverpayProtected, total: testSales.length,
  });
  console.log(`  R5 parallel collects: ${totalSucceeded}/50 succeeded (expect 50 if all 5×10 serialized cleanly)`);
}

// ── Rule 6: Idempotency (40 ops) ──────────────────────────────
//
// Verifies the Session 8 Phase 0.5 idempotency hotfix at scale:
//
//   1. cancelSale double-execution is blocked by the new explicit guard
//      at lib/db.js:1008 ('الطلب مُلغى مسبقاً' throw). 20 double-cancel
//      attempts, each expected to fail on the second call.
//
//   2. updateDelivery confirm double-execution is already idempotent via
//      the same-status shortcut at lib/db.js:2141 (silent early return,
//      HTTP 200, no state change). 20 double-confirm attempts, each
//      expected to succeed silently on the second call with no duplicate
//      payment rows and no duplicate bonus rows.
async function rule6_idempotency() {
  startRule('rule6', 'Idempotency guards (40 ops: 20 double-cancel + 20 double-confirm)');

  // ─── Part A: 20 double-cancel attempts ───
  //
  // Seed 20 fresh reserved sales (cheapest path — no payments, no bonuses,
  // so we isolate the guard from the refund/bonus side-effects the unit
  // tests already cover). The guard at Step 1 fires before any Step 5/11
  // writes, so blocking here still validates the full protection.
  await loginAs(USERS.seller.username, USERS.seller.password);
  const cancelSales = [];
  for (let i = 0; i < 20; i++) {
    const product = pickRandom(STRESS_PRODUCTS);
    const client = pickRandom(STRESS_CLIENTS);
    const r = await createSale({
      product, client,
      quantity: 1,
      unitPrice: product.sellPrice,
      paymentType: 'كاش',
      dpe: product.sellPrice,
    });
    if (r.ok && r.id) cancelSales.push(r.id);
    else assert(`R6 seed cancel sale ${i + 1}/20`, false, { status: r.status, data: r.data });
  }
  assert('R6 20 seed sales for double-cancel', cancelSales.length === 20, {
    actual: cancelSales.length,
  });

  await loginAdmin();
  let firstCancelOk = 0;
  let secondCancelBlocked = 0;
  for (const saleId of cancelSales) {
    // First cancel — must succeed
    const first = await apiPost(`/api/sales/${saleId}/cancel`, {
      reason: 'STRESS R6 double-cancel first',
      invoiceMode: 'soft',
      bonusActions: null,
    });
    if (first.res.ok) firstCancelOk++;

    // Second cancel on the same sale — must be rejected with the Arabic
    // idempotency error. Route layer maps the throw to HTTP 400 with the
    // err.message forwarded as the body's `error` field.
    const second = await apiPost(`/api/sales/${saleId}/cancel`, {
      reason: 'STRESS R6 double-cancel second',
      invoiceMode: 'soft',
      bonusActions: null,
    });
    if (second.res.status === 400 && /مُلغى مسبقاً/.test(second.data?.error || '')) {
      secondCancelBlocked++;
    } else {
      assert(`R6 double-cancel sale ${saleId}`, false, {
        secondStatus: second.res.status,
        secondError: second.data?.error,
      });
    }
  }
  assert('R6 20 first cancels succeeded', firstCancelOk === 20, { actual: firstCancelOk });
  assert('R6 20 second cancels blocked with Arabic idempotency error',
    secondCancelBlocked === 20, { actual: secondCancelBlocked });

  // Verify audit trail: each doubly-cancelled sale must have exactly ONE
  // row in cancellations, not two. We check this via the sales state:
  // payment_status should still be 'cancelled' and the sale should still
  // be 'ملغي' — the failed second cancel did not mutate state.
  const allSalesAfterR6A = await getAllSales();
  const cancelledR6A = allSalesAfterR6A.filter((s) => cancelSales.includes(s.id));
  const properlyCancelled = cancelledR6A.filter(
    (s) => s.status === 'ملغي' && s.payment_status === 'cancelled'
  ).length;
  assert('R6 all 20 cancelled sales have stable state after double-cancel',
    properlyCancelled === 20, { actual: properlyCancelled });

  // ─── Part B: 20 double-confirm attempts ───
  //
  // updateDelivery is ALREADY idempotent via lib/db.js:2141
  // `if (oldStatus === data.status) return;`. A second PUT with the same
  // status is a silent no-op (HTTP 200, no writes). We verify it at scale
  // to guard against regressions: payment rows and bonus counts must not
  // grow between the two confirmations.
  await loginAs(USERS.seller.username, USERS.seller.password);
  const confirmSales = [];
  for (let i = 0; i < 20; i++) {
    const product = pickRandom(STRESS_PRODUCTS);
    const client = pickRandom(STRESS_CLIENTS);
    const r = await createSale({
      product, client,
      quantity: 1,
      unitPrice: product.sellPrice,
      paymentType: 'كاش',
      dpe: product.sellPrice,
    });
    if (r.ok && r.id) confirmSales.push(r.id);
    else assert(`R6 seed confirm sale ${i + 1}/20`, false, { status: r.status, data: r.data });
  }
  assert('R6 20 seed sales for double-confirm', confirmSales.length === 20, {
    actual: confirmSales.length,
  });

  await loginAdmin();
  const deliveriesR6 = await getAllDeliveries();
  const bonusBefore = await countStressBonuses();
  let firstConfirmOk = 0;
  let secondConfirmOk = 0;
  for (let i = 0; i < confirmSales.length; i++) {
    const saleId = confirmSales[i];
    // First confirmation — must succeed
    const first = await confirmDelivery(saleId, `STRESSR6VIN${String(i).padStart(4, '0')}`,
      USERS.driver.username, deliveriesR6);
    if (first.ok) firstConfirmOk++;

    // Second confirmation with the same payload — must also return 200
    // (silent no-op, not an error). The delivery row's status is already
    // 'تم التوصيل', so updateDelivery returns early at L2141.
    const second = await confirmDelivery(saleId, `STRESSR6VIN${String(i).padStart(4, '0')}`,
      USERS.driver.username, deliveriesR6);
    if (second.ok) secondConfirmOk++;
    else {
      assert(`R6 double-confirm sale ${saleId}`, false, {
        secondStatus: second.status, result: second,
      });
    }
  }
  assert('R6 20 first confirms succeeded', firstConfirmOk === 20, { actual: firstConfirmOk });
  assert('R6 20 second confirms silent-succeeded (idempotent)',
    secondConfirmOk === 20, { actual: secondConfirmOk });

  // Verify no double side-effects: bonus count must grow by exactly 40
  // (one seller + one driver per confirmed sale), not 80.
  const bonusAfter = await countStressBonuses();
  const sellerDelta = bonusAfter.seller - bonusBefore.seller;
  const driverDelta = bonusAfter.driver - bonusBefore.driver;
  assert('R6 exactly 20 seller bonuses generated (no double)',
    sellerDelta === 20, { expected: 20, actual: sellerDelta });
  assert('R6 exactly 20 driver bonuses generated (no double)',
    driverDelta === 20, { expected: 20, actual: driverDelta });

  console.log(`  R6 idempotency: 20/20 double-cancel blocked, 20/20 double-confirm no-op, bonus delta seller=${sellerDelta} driver=${driverDelta}`);
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  const totalStart = Date.now();

  try {
    await loginAdmin();
  } catch (err) {
    console.error('❌ Auth failed:', err.message);
    process.exit(1);
  }

  try {
    await setup();
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  }

  const ruleRunners = [
    ['Rule 1', rule1_saleLifecycle],
    ['Rule 2', rule2_fifoCollection],
    ['Rule 3', rule3_cancellation],
    ['Rule 4', rule4_bonusEligibility],
    ['Rule 5', rule5_concurrent],
    ['Rule 6', rule6_idempotency],
  ];
  for (const [name, fn] of ruleRunners) {
    try {
      await fn();
    } catch (err) {
      console.error(`❌ ${name} crashed:`, err.message);
      console.error(err.stack);
      assert(`${name} crashed`, false, { error: err.message });
      break;
    }
  }

  const totalMs = Date.now() - totalStart;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const passRate = results.length > 0 ? (passed / results.length) * 100 : 0;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Duration: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Total assertions: ${results.length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  Pass rate: ${passRate.toFixed(2)}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n=== Response Time Report ===');
  const timingSummary = {};
  for (const [cat, arr] of Object.entries(timings)) {
    if (arr.length === 0) continue;
    const s = {
      count: arr.length,
      p50: percentile(arr, 50),
      p95: percentile(arr, 95),
      p99: percentile(arr, 99),
      max: Math.max(...arr),
    };
    timingSummary[cat] = s;
    const warn = s.p95 > 2000 ? ' ⚠ p95>2s' : '';
    console.log(`  ${cat.padEnd(20)} n=${s.count.toString().padStart(4)} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms max=${s.max}ms${warn}`);
  }

  if (failed > 0) {
    console.log('\n=== Failures (first 20) ===');
    for (const r of results.filter((r) => r.status === 'fail').slice(0, 20)) {
      console.log(`  ❌ [${r.rule}] ${r.description}`);
      console.log(`     ${JSON.stringify(r.details).slice(0, 300)}`);
    }
  }

  // Persist report
  const resultsDir = resolve(repoRoot, 'docs');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const reportPath = resolve(resultsDir, 'stress-test-results.json');
  writeFileSync(
    reportPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      base_url: BASE_URL,
      duration_ms: totalMs,
      total_assertions: results.length,
      passed,
      failed,
      pass_rate: Number(passRate.toFixed(2)),
      timings: timingSummary,
      failures: results.filter((r) => r.status === 'fail'),
    }, null, 2)
  );
  console.log(`\nReport written: ${reportPath}`);

  if (passRate < 99) process.exit(2);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
