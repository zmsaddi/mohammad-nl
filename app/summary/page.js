'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/utils';
import Link from 'next/link';
import VoiceButton from '@/components/VoiceButton';
import VoiceConfirm from '@/components/VoiceConfirm';
import PageSkeleton from '@/components/PageSkeleton';
import DataCardList from '@/components/DataCardList';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
  LineChart, Line,
} from 'recharts';

const COLORS = ['#1e40af', '#16a34a', '#f59e0b', '#dc2626', '#8b5cf6', '#ec4899'];

function SummaryContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';
  // DONE: Step 8 — inventory breakdown is admin/manager only (cost data)
  const canSeeCosts = ['admin', 'manager'].includes(session?.user?.role);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // v1.1 F-022 — track fetch errors separately from empty-data so the UI
  // can show a retry button instead of silently rendering the empty state.
  const [fetchError, setFetchError] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [voiceResult, setVoiceResult] = useState(null);
  // PA-06 — tab state for splitting the summary page
  const [activeTab, setActiveTab] = useState('quick');
  // DONE: Step 8 — products fetched separately for the category breakdown card
  const [productList, setProductList] = useState([]);
  // Dashboard revamp — current treasury balance (admin/manager/driver; null when
  // disabled or unavailable). Fetched alongside the summary, failure-tolerant.
  const [treasury, setTreasury] = useState(null);
  const canUseVoice = ['admin', 'manager', 'seller'].includes(session?.user?.role);

  const fetchData = async (from, to) => {
    setLoading(true);
    setFetchError(false);
    try {
      let url = '/api/summary';
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (params.toString()) url += `?${params}`;

      // DONE: Step 8 — fetch products in parallel with the summary
      const [summaryRes, productsRes] = await Promise.all([
        fetch(url, { cache: 'no-store' }),
        fetch('/api/products', { cache: 'no-store' }),
      ]);
      if (!summaryRes.ok) throw new Error(`summary API ${summaryRes.status}`);
      const result = await summaryRes.json();
      const products = await productsRes.json();
      setData(result);
      setProductList(Array.isArray(products) ? products : []);
      // Dashboard revamp — current treasury balance. Allowed for
      // admin/manager/driver; sellers get 403 → treated as unavailable. Any
      // failure (disabled flag, network) degrades gracefully to no card.
      try {
        const tRes = await fetch('/api/treasury/boxes', { cache: 'no-store' });
        setTreasury(tRes.ok ? await tRes.json() : null);
      } catch { setTreasury(null); }
    } catch (err) {
      // v1.1 F-022 — set fetchError so the render shows a retry button
      // instead of silently rendering the empty state.
      setFetchError(true);
      addToast('خطأ في جلب البيانات — اضغط "إعادة المحاولة" أدناه', 'error');
    } finally {
      setLoading(false);
    }
  };

  // v1.2 — CSV export covers all three P&L views and the corrected
  // cash-flow block. Old section "مبيعات كاش / بنك / آجل" replaced by
  // the actual money-flow numbers from payments + supplier_payments.
  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ['البند', 'المبلغ'],
      ['=== متوقعة (Pipeline) ===', ''],
      ['إيرادات متوقعة', data.projectedRevenue || 0],
      ['COGS متوقع', data.projectedCOGS || 0],
      ['ربح إجمالي متوقع', data.projectedGrossProfit || 0],
      ['صافي متوقع (بدون عمولات المحجوز)', data.projectedNetProfit || 0],
      [''],
      ['=== استحقاق (بعد التسليم) ===', ''],
      ['إيرادات مؤكدة', data.totalRevenue],
      ['تكلفة البضاعة المباعة', data.totalCOGS],
      ['الربح الإجمالي', data.grossProfit],
      ['المصاريف التشغيلية', data.totalExpenses],
      ['عمولات مدفوعة', data.totalBonusPaid],
      ['عمولات مستحقة', data.totalBonusOwed],
      ['صافي الربح', data.netProfit],
      [''],
      ['=== محصّل نقداً ===', ''],
      ['إيرادات محصّلة', data.totalRevenueCashBasis || 0],
      ['تكلفة المحصّل', data.totalCOGSCashBasis || 0],
      ['صافي الربح المحصّل', data.netProfitCashBasis || 0],
      [''],
      ['=== الحالة ===', ''],
      ['إجمالي المشتريات', data.totalPurchases],
      ['قيمة المخزون', data.inventoryValue],
      ['الديون المستحقة', data.totalDebt],
      [''],
      ['=== التدفق النقدي الفعلي (الفترة) ===', ''],
      ['تحصيلات من عملاء — كاش', data.cashFlowSalesCash || 0],
      ['تحصيلات من عملاء — بنك', data.cashFlowSalesBank || 0],
      ['دفعات للموردين — كاش', data.cashFlowPurchasesCash || 0],
      ['دفعات للموردين — بنك', data.cashFlowPurchasesBank || 0],
      ['مصاريف — كاش', data.cashFlowExpensesCash || 0],
      ['مصاريف — بنك', data.cashFlowExpensesBank || 0],
      ['صافي التدفق — كاش', data.cashFlowNetCash || 0],
      ['صافي التدفق — بنك', data.cashFlowNetBank || 0],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = dateFrom && dateTo ? `${dateFrom}_${dateTo}` : new Date().toISOString().split('T')[0];
    a.download = `vitesse-eco-report-${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // DONE: Fix 3 — branch on seller payload
  const isSellerView = data?.sellerView === true;
  // Dashboard revamp — drivers now get a dedicated payload + view (was 403).
  const isDriverView = data?.driverView === true;

  // DONE: Fix 6 — gross + net margin (used inside the P&L cards)
  const grossMargin = data && data.totalRevenue > 0
    ? ((data.grossProfit / data.totalRevenue) * 100).toFixed(1)
    : '0';
  const netMargin = data && data.totalRevenue > 0
    ? ((data.netProfit / data.totalRevenue) * 100).toFixed(1)
    : '0';

  // v1.2 — category breakdown now iterates the ACTUAL product rows instead
  // of the fixed PRODUCT_CATEGORIES list. Pre-v1.2 any product whose
  // category was NULL, empty, or typed differently (e.g. legacy data or a
  // voice-entry typo) was silently excluded from the breakdown — yet it
  // still contributed to `inventoryValue` on the KPI card, so the card and
  // the breakdown didn't add up. Unknown/blank categories now fall into
  // "غير مصنّف" so the breakdown sum = inventoryValue by construction.
  const categoryBreakdown = canSeeCosts
    ? Object.values(productList.reduce((acc, p) => {
        const raw = (p.category || '').trim();
        const cat = raw === '' ? 'غير مصنّف' : raw;
        if (!acc[cat]) {
          acc[cat] = { category: cat, count: 0, totalStock: 0, totalValue: 0, lowCount: 0, outCount: 0 };
        }
        const stock = parseFloat(p.stock) || 0;
        acc[cat].count++;
        acc[cat].totalStock += stock;
        acc[cat].totalValue += stock * (parseFloat(p.buy_price) || 0);
        if (stock > 0 && stock <= (p.low_stock_threshold ?? 3)) acc[cat].lowCount++;
        if (stock <= 0) acc[cat].outCount++;
        return acc;
      }, {})).sort((a, b) => b.totalValue - a.totalValue)
    : [];

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(() => fetchData(dateFrom, dateTo));

  const handleFilter = () => {
    fetchData(dateFrom, dateTo);
  };

  const handlePreset = (preset) => {
    const now = new Date();
    let from, to;

    if (preset === 'thisMonth') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      to = now.toISOString().split('T')[0];
    } else if (preset === 'lastMonth') {
      // v1.1 F-019 — fixed January edge case. Pre-v1.1 the `to` formula
      // used `now.getMonth()` as the month number — but getMonth() returns
      // 0-based (0=Jan), so in January it produced "YYYY-00-DD" which is
      // an invalid date. Now computed via `last` (the first day of the
      // previous month) + getDaysInMonth pattern.
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const daysInLastMonth = new Date(last.getFullYear(), last.getMonth() + 1, 0).getDate();
      from = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-01`;
      to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${daysInLastMonth}`;
    } else if (preset === 'thisYear') {
      from = `${now.getFullYear()}-01-01`;
      to = now.toISOString().split('T')[0];
    } else {
      from = '';
      to = '';
    }

    setDateFrom(from);
    setDateTo(to);
    fetchData(from, to);
  };

  const pieData = data?.expenseByCategory
    ? Object.entries(data.expenseByCategory).map(([name, value]) => ({ name, value }))
    : [];

  // Dashboard revamp — stock alerts derived from the already-fetched product
  // list (no extra request). Surfaced as a prominent alert instead of being
  // buried in the per-category table.
  const outStockItems = productList.filter((p) => (parseFloat(p.stock) || 0) <= 0);
  const lowStockItems = productList.filter((p) => {
    const s = parseFloat(p.stock) || 0;
    return s > 0 && s <= (p.low_stock_threshold ?? 3);
  });

  // Dashboard revamp — current treasury balance across visible boxes (only when
  // the treasury feature is live and returned boxes).
  const treasuryEnabled = treasury?.enabled === true && Array.isArray(treasury?.boxes) && treasury.boxes.length > 0;
  const treasuryTotal = treasuryEnabled
    ? treasury.boxes.reduce((s, b) => s + (parseFloat(b.balance) || 0), 0)
    : 0;

  // Dashboard revamp — ↑↓ delta vs the previous comparable period. Returns null
  // when there's no prior baseline (e.g. "all-time" filter, or prev period = 0).
  const renderDelta = (cur, prev) => {
    if (prev == null || !Number.isFinite(Number(prev)) || Number(prev) === 0) return null;
    const c = Number(cur) || 0;
    const p = Number(prev);
    const d = ((c - p) / Math.abs(p)) * 100;
    const up = d >= 0;
    return (
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: up ? '#16a34a' : '#dc2626' }}
            title={`مقارنةً بالفترة السابقة المماثلة (${formatNumber(p)})`}>
        {up ? '▲' : '▼'} {Math.abs(d).toFixed(0)}%
      </span>
    );
  };

  return (
    <AppLayout>
      <div className="page-header">
        <h2>لوحة التحكم</h2>
        <p>نظرة شاملة على أداء المتجر</p>
      </div>

      {/* Action Bar */}
      <div className="action-bar">
        {canUseVoice && process.env.NEXT_PUBLIC_VOICE_ENABLED !== 'false' && (
          <VoiceButton
            compact
            onResult={(r) => setVoiceResult(r)}
            onError={(e) => addToast(e, 'error')}
          />
        )}
        <Link href="/sales?new=1" className="sell-btn">
          + عملية بيع
        </Link>
        {['admin', 'manager'].includes(session?.user?.role) && (
          <Link href="/purchases?new=1" className="buy-btn">
            + عملية شراء
          </Link>
        )}
      </div>

      {/* Voice Confirmation Modal */}
      <VoiceConfirm
        result={voiceResult}
        userRole={session?.user?.role}
        onConfirm={async (endpoint, submitData) => {
          const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submitData), cache: 'no-store' });
          if (res.ok) {
            const d = await res.json().catch(() => ({}));
            addToast('تم الحفظ بنجاح!'); setVoiceResult(null); fetchData(dateFrom, dateTo);
            return d.id || null;
          }
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'خطأ في الحفظ');
        }}
        onCancel={() => setVoiceResult(null)}
        onRetry={() => setVoiceResult(null)}
      />

      {/* Filter Chips */}
      {!isSellerView && !isDriverView && (
        <div className="filter-bar-v2">
          <div className="filter-chips">
            <button className={`chip${!dateFrom && !dateTo && !showCustomDate ? ' active' : ''}`} onClick={() => { handlePreset('thisMonth'); setShowCustomDate(false); }}>هذا الشهر</button>
            <button className="chip" onClick={() => { handlePreset('lastMonth'); setShowCustomDate(false); }}>الشهر الماضي</button>
            <button className="chip" onClick={() => { handlePreset('thisYear'); setShowCustomDate(false); }}>هذه السنة</button>
            <button className="chip" onClick={() => { handlePreset('all'); setShowCustomDate(false); }}>الكل</button>
            <button className={`chip${showCustomDate ? ' active' : ''}`} onClick={() => setShowCustomDate(!showCustomDate)}>📅 فترة مخصصة</button>
          </div>
          {data && canSeeCosts && (
            <button className="csv-btn" onClick={exportCSV}>📥 CSV</button>
          )}
        </div>
      )}
      {!isSellerView && !isDriverView && showCustomDate && (
        <div className="date-range-row">
          <input type="date" className="date-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>إلى</span>
          <input type="date" className="date-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button className="filter-apply-btn" onClick={handleFilter}>تصفية</button>
        </div>
      )}

      {loading ? (
        <PageSkeleton rows={4} />
      ) : data && isSellerView ? (
        /* DONE: Fix 3 — seller-only personal dashboard */
        <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', color: '#1e293b' }}>
            إحصائياتي الشخصية
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#16a34a' }}>مبيعات مؤكدة</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d' }}>{data.totalSales}</div>
            </div>
            <div style={{ padding: '16px', background: '#dbeafe', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#1e40af' }}>إيراداتي</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e40af' }}>{formatNumber(data.totalRevenue)}</div>
            </div>
            <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#d97706' }}>محجوز ({data.reservedCount})</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#d97706' }}>{formatNumber(data.reservedRevenue)}</div>
            </div>
            <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#16a34a' }}>عمولات مستحقة</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d' }}>{formatNumber(data.totalBonusOwed)}</div>
            </div>
            <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '12px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '0.8rem', color: '#16a34a' }}>عمولات تم صرفها</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.totalBonusPaid)}</div>
            </div>
          </div>
          {/* Dashboard revamp — the seller's actual reserved orders (was: a count
              only). Lets the seller see WHICH orders await delivery. */}
          {data.reservedList?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#92400e', marginBottom: 10 }}>
                طلباتي المحجوزة (بانتظار التوصيل) — {data.reservedList.length}
              </h4>
              <DataCardList
                rows={data.reservedList}
                fields={[
                  { key: 'date', label: 'التاريخ' },
                  { key: 'client_name', label: 'العميل' },
                  { key: 'item', label: 'المنتج' },
                  { key: 'total', label: 'القيمة', format: (v) => formatNumber(v) },
                ]}
                emptyMessage="لا توجد طلبات محجوزة"
              />
            </div>
          )}
        </div>
      ) : data && isDriverView ? (
        /* Dashboard revamp — driver personal dashboard (deliveries + commissions) */
        <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', color: '#1e293b' }}>
            لوحتي — التوصيلات والعمولات
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: 16 }}>
            <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#d97706' }}>قيد الانتظار</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#b45309' }}>{data.pendingCount || 0}</div>
            </div>
            <div style={{ padding: '16px', background: '#dbeafe', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#1e40af' }}>جاري التوصيل</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1e40af' }}>{data.inTransitCount || 0}</div>
            </div>
            <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#16a34a' }}>عمولات مستحقة</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.totalBonusOwed || 0)}</div>
            </div>
            <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '12px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '0.8rem', color: '#16a34a' }}>عمولات تم صرفها</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.totalBonusPaid || 0)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#374151' }}>توصيلاتي الحالية</h4>
            <Link href="/deliveries" className="btn btn-sm btn-outline">فتح صفحة التوصيل &larr;</Link>
          </div>
          <DataCardList
            rows={data.deliveries || []}
            fields={[
              { key: 'date', label: 'التاريخ' },
              { key: 'client_name', label: 'العميل' },
              { key: 'address', label: 'العنوان' },
              { key: 'items', label: 'الأصناف' },
              { key: 'status', label: 'الحالة' },
            ]}
            emptyMessage="لا توجد توصيلات حالية"
          />
          <div className="table-container has-card-fallback">
            <table className="data-table">
              <thead>
                <tr><th>التاريخ</th><th>العميل</th><th>العنوان</th><th>الأصناف</th><th>الحالة</th></tr>
              </thead>
              <tbody>
                {(data.deliveries || []).map((d, i) => (
                  <tr key={i}>
                    <td>{d.date}</td>
                    <td style={{ fontWeight: 600 }}>{d.client_name}</td>
                    <td>{d.address}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.items}</td>
                    <td>
                      <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600,
                        background: d.status === 'قيد الانتظار' ? '#fef3c7' : '#dbeafe',
                        color: d.status === 'قيد الانتظار' ? '#d97706' : '#3b82f6' }}>
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : data ? (
        <>
          {/* PA-06 — Tab navigation */}
          <div className="tabs" style={{ marginBottom: '24px' }}>
            <button className={`tab ${activeTab === 'quick' ? 'active' : ''}`} onClick={() => setActiveTab('quick')}>ملخص سريع</button>
            <button className={`tab ${activeTab === 'pnl' ? 'active' : ''}`} onClick={() => setActiveTab('pnl')}>الأرباح والخسائر</button>
            <button className={`tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>التقارير</button>
          </div>

          {/* ===== Tab 1: ملخص سريع — KPI cards & revenue breakdown ===== */}
          {activeTab === 'quick' && (
            <>
              {/* Actions required now — placed FIRST per the owner's request: the
                  operational queue (awaiting delivery, bank-receipt queue,
                  reserved orders, out/low stock). Each tile shows only when it
                  has items. */}
              {((data.reservedCount || 0) > 0 || (data.awaitingDeliveryCount || 0) > 0 || (data.bankPendingCount || 0) > 0 || outStockItems.length > 0 || lowStockItems.length > 0) && (
                <div className="card" style={{ marginBottom: 24, padding: 16, borderRight: '4px solid #f59e0b' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#92400e', marginBottom: 12 }}>⚡ إجراءات مطلوبة الآن</h3>
                  <div className="action-tiles">
                    {(data.awaitingDeliveryCount || 0) > 0 && (
                      <Link href="/deliveries" className="action-tile">
                        <span className="action-tile-num" style={{ color: '#d97706' }}>{data.awaitingDeliveryCount}</span>
                        <span className="action-tile-label">طلبات بانتظار التسليم</span>
                        <span className="action-tile-sub">بقيمة {formatNumber(data.awaitingDeliveryValue || 0)}</span>
                      </Link>
                    )}
                    {(data.bankPendingCount || 0) > 0 && (
                      <Link href="/sales" className="action-tile">
                        <span className="action-tile-num" style={{ color: '#7c3aed' }}>{data.bankPendingCount}</span>
                        <span className="action-tile-label">بنك بانتظار الاستلام</span>
                        <span className="action-tile-sub">بقيمة {formatNumber(data.bankPendingValue || 0)}</span>
                      </Link>
                    )}
                    {(data.reservedCount || 0) > 0 && (
                      <button className="action-tile" onClick={() => setActiveTab('pnl')}>
                        <span className="action-tile-num" style={{ color: '#8b5cf6' }}>{data.reservedCount}</span>
                        <span className="action-tile-label">طلبات محجوزة</span>
                        <span className="action-tile-sub">ربح متوقع {formatNumber(data.reservedProfit || 0)}</span>
                      </button>
                    )}
                    {outStockItems.length > 0 && (
                      <Link href="/stock" className="action-tile">
                        <span className="action-tile-num" style={{ color: '#dc2626' }}>{outStockItems.length}</span>
                        <span className="action-tile-label">منتجات نفدت</span>
                        <span className="action-tile-sub">إعادة الطلب</span>
                      </Link>
                    )}
                    {lowStockItems.length > 0 && (
                      <Link href="/stock" className="action-tile">
                        <span className="action-tile-num" style={{ color: '#d97706' }}>{lowStockItems.length}</span>
                        <span className="action-tile-label">مخزون منخفض</span>
                        <span className="action-tile-sub">قارب على النفاد</span>
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* KPI Cards — the owner's morning questions: how much did I really
                  make (collected), how did the cash move, what's owed TO me, and
                  what I owe. The accrual net-profit KPI moved to the الأرباح
                  والخسائر tab so two competing "net profit" figures no longer sit
                  side by side. ↑↓ delta compares to the previous equal period. */}
              <div className="kpi-grid">
                {[
                  { label: 'صافي الربح المحصّل', value: data.netProfitCashBasis || 0, icon: '📊', color: '#6366f1', prev: data.prevNetProfitCashBasis },
                  { label: 'صافي التدفق النقدي', value: (data.cashFlowNetCash || 0) + (data.cashFlowNetBank || 0), icon: '💵', color: '#0ea5e9' },
                  { label: 'ديون العملاء (لنا)', value: data.totalDebt, icon: '📥', color: '#16a34a' },
                  { label: 'مستحقات الموردين (علينا)', value: data.supplierPayablesTotal || 0, icon: '📤', color: '#f43f5e' },
                ].map((kpi, i) => {
                  const num = parseFloat(kpi.value) || 0;
                  return (
                    <div key={i} className="kpi-card" style={{ borderRight: `3px solid ${kpi.color}`, animationDelay: `${i * 0.07}s` }}>
                      <div className="kpi-top">
                        <span style={{ fontSize: 24 }}>{kpi.icon}</span>
                        <span className="kpi-label">{kpi.label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span className="kpi-value" style={{ color: num === 0 ? '#cbd5e1' : kpi.color }}>
                          {num === 0 ? '—' : formatNumber(num)}
                        </span>
                        {'prev' in kpi && renderDelta(num, kpi.prev)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Today strip — a quick "what happened today" pulse */}
              <div className="today-strip">
                <div className="today-item" style={{ borderTop: '3px solid #16a34a' }}>
                  <span className="today-label">مبيعات اليوم</span>
                  <span className="today-value">{formatNumber(data.todayRevenue || 0)}</span>
                </div>
                <div className="today-item" style={{ borderTop: '3px solid #0ea5e9' }}>
                  <span className="today-label">تحصيلات اليوم</span>
                  <span className="today-value">{formatNumber(data.todayCollections || 0)}</span>
                </div>
                <div className="today-item" style={{ borderTop: '3px solid #f59e0b' }}>
                  <span className="today-label">مصاريف اليوم</span>
                  <span className="today-value">{formatNumber(data.todayExpenses || 0)}</span>
                </div>
              </div>

              {/* Current treasury balance — only when the treasury feature is live */}
              {treasuryEnabled && (
                <div className="card" style={{ marginBottom: 24, padding: 16, borderRight: '4px solid #0ea5e9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: treasury.boxes.length > 1 ? 12 : 0 }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0369a1' }}>🏦 النقد الحالي في الصناديق</h3>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0369a1' }}>{formatNumber(treasuryTotal)}</span>
                  </div>
                  {treasury.boxes.length > 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {treasury.boxes.map((b) => (
                        <span key={b.id} style={{ fontSize: '0.8rem', background: '#f0f9ff', color: '#0369a1', borderRadius: 8, padding: '4px 10px' }}>
                          {b.type === 'main' ? 'الصندوق العام' : (b.owner_name || b.owner_username || 'صندوق')}: <strong>{formatNumber(parseFloat(b.balance) || 0)}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* الطلبات بانتظار التسليم — explicit admin/manager request: the full
                  queue of orders awaiting handover (not just a count). */}
              {data.awaitingDelivery?.length > 0 && (
                <div className="card" style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                    الطلبات بانتظار التسليم ({data.awaitingDeliveryCount}) — بقيمة {formatNumber(data.awaitingDeliveryValue || 0)}
                  </h3>
                  <DataCardList
                    rows={data.awaitingDelivery}
                    fields={[
                      { key: 'date', label: 'التاريخ' },
                      { key: 'client_name', label: 'العميل' },
                      { key: 'address', label: 'العنوان' },
                      { key: 'items', label: 'الأصناف' },
                      { key: 'status', label: 'الحالة' },
                    ]}
                    emptyMessage="لا توجد طلبات"
                  />
                  <div className="table-container has-card-fallback">
                    <table className="data-table">
                      <thead>
                        <tr><th>التاريخ</th><th>العميل</th><th>العنوان</th><th>الأصناف</th><th>الحالة</th></tr>
                      </thead>
                      <tbody>
                        {data.awaitingDelivery.map((d, i) => (
                          <tr key={i}>
                            <td>{d.date}</td>
                            <td style={{ fontWeight: 600 }}>{d.client_name}</td>
                            <td>{d.address}</td>
                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.items}</td>
                            <td>
                              <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600,
                                background: d.status === 'قيد الانتظار' ? '#fef3c7' : '#dbeafe',
                                color: d.status === 'قيد الانتظار' ? '#d97706' : '#3b82f6' }}>
                                {d.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* v1.2 — REAL cash-flow table. Replaces the pre-v1.2 "Cash/Bank
                  Breakdown" that classified sales by declared payment_type — a
                  credit sale later paid in cash showed 0 in the cash column.
                  Now reads from payments (clients), supplier_payments
                  (suppliers), and expenses (with explicit =كاش/=بنك filters).
                  Sign convention: Sales are inflow (+), Purchases and Expenses
                  are outflow (−). The bottom row is the net cash movement
                  per column. */}
              <div className="section-header">
                <span style={{ fontSize: 18 }}>💳</span>
                <span>التدفق النقدي الفعلي — في الفترة المختارة</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>
                أرقام حقيقية من جدول المدفوعات (ليست من طريقة البيع المعلنة) — تشمل تحصيلات ديون سابقة ودفعات موردين جزئية.
              </div>
              {/* Detailed cash-flow — wrapped so it scrolls horizontally on
                  mobile instead of squishing its 4 columns. The headline
                  "صافي التدفق النقدي" already sits in the KPI row above. */}
              <div className="cash-scroll" style={{ marginBottom: 24 }}>
                <div className="cash-table">
                <div className="cash-header" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 1fr' }}>
                  <div className="cash-col"></div>
                  <div className="cash-col cash-col-header"><span style={{ color: '#10b981' }}>●</span> كاش</div>
                  <div className="cash-col cash-col-header"><span style={{ color: 'var(--color-accent)' }}>●</span> بنك</div>
                  <div className="cash-col cash-col-header">المجموع</div>
                </div>
                {[
                  { label: 'تحصيلات من عملاء', cash: data.cashFlowSalesCash || 0, bank: data.cashFlowSalesBank || 0, sign: '+' },
                  { label: 'دفعات للموردين', cash: data.cashFlowPurchasesCash || 0, bank: data.cashFlowPurchasesBank || 0, sign: '−' },
                  { label: 'مصاريف', cash: data.cashFlowExpensesCash || 0, bank: data.cashFlowExpensesBank || 0, sign: '−' },
                ].map((row, i) => {
                  const rowTotal = row.cash + row.bank;
                  const outflow = row.sign === '−';
                  return (
                    <div key={i} className="cash-row" style={{ background: i % 2 === 0 ? 'rgba(99,102,241,0.03)' : 'transparent', gridTemplateColumns: '1.3fr 1fr 1fr 1fr' }}>
                      <div className="cash-col cash-col-label">
                        {outflow && <span style={{ color: '#dc2626', marginLeft: 4 }}>−</span>}
                        {row.label}
                      </div>
                      <div className="cash-col">
                        {row.cash > 0
                          ? <span className="cash-highlight" style={{ color: outflow ? '#dc2626' : '#10b981' }}>{formatNumber(row.cash)}</span>
                          : <span className="cash-zero">—</span>}
                      </div>
                      <div className="cash-col">
                        {row.bank > 0
                          ? <span style={{ fontWeight: 700, color: outflow ? '#dc2626' : 'var(--color-accent)' }}>{formatNumber(row.bank)}</span>
                          : <span className="cash-zero">—</span>}
                      </div>
                      <div className="cash-col">
                        {rowTotal > 0
                          ? <span style={{ fontWeight: 700, color: outflow ? '#dc2626' : '#334155' }}>{formatNumber(rowTotal)}</span>
                          : <span className="cash-zero">—</span>}
                      </div>
                    </div>
                  );
                })}
                <div className="cash-total-row" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 1fr' }}>
                  <div className="cash-col" style={{ fontWeight: 700 }}>صافي التدفق</div>
                  <div className="cash-col">
                    <span style={{ fontWeight: 800, color: (data.cashFlowNetCash || 0) >= 0 ? '#10b981' : '#dc2626' }}>
                      {formatNumber(data.cashFlowNetCash || 0)}
                    </span>
                  </div>
                  <div className="cash-col">
                    <span style={{ fontWeight: 800, color: (data.cashFlowNetBank || 0) >= 0 ? 'var(--color-accent)' : '#dc2626' }}>
                      {formatNumber(data.cashFlowNetBank || 0)}
                    </span>
                  </div>
                  <div className="cash-col">
                    <span style={{ fontWeight: 800, color: ((data.cashFlowNetCash || 0) + (data.cashFlowNetBank || 0)) >= 0 ? '#1e293b' : '#dc2626' }}>
                      {formatNumber((data.cashFlowNetCash || 0) + (data.cashFlowNetBank || 0))}
                    </span>
                  </div>
                </div>
                </div>
              </div>

              {/* Net-profit trend — moved here from the Reports tab so the
                  owner's "am I improving?" question is answered up front.
                  Independent trailing-6-month window (not the date filter). */}
              <div className="chart-card" style={{ marginBottom: 24 }}>
                <h3>اتجاه صافي الربح (آخر 6 شهور)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatNumber(value)} />
                    <Legend />
                    <Line type="monotone" dataKey="profit" name="صافي الربح" stroke="#1e40af" strokeWidth={2} dot={{ fill: '#1e40af' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* ===== Tab 2: الأرباح والخسائر — P&L detailed cards ===== */}
          {activeTab === 'pnl' && (
            <>
          {/* Plain-language explainer up front so a non-accountant can tell the
              three views apart at a glance (agents' decision: lead with cash). */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: '0.82rem', color: '#475569', lineHeight: 1.9 }}>
            <strong>الفرق باختصار:</strong> المحصّل = ما قبضته فعلاً نقداً · الاستحقاق = ما بِعته وسلّمته (على الورق) · المتوقّع = لو سُلّمت كل الطلبات المحجوزة.
          </div>

          {/* (1) Cash-basis P&L — what actually reached the till. Leads because
              it's the most relevant view for the owner (agents' decision). */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px', borderRight: '4px solid #0ea5e9' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px', color: '#0369a1' }}>
              الأرباح والخسائر — المحصّل نقداً
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '16px' }}>
              المبيعات المدفوعة 100% فقط — الصفقات الجزئية لا تُحتسب حتى تُدفع بالكامل.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', background: '#e0f2fe', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 500 }}>إيرادات محصّلة ({data.paidSalesCount || 0})</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#075985' }}>{formatNumber(data.totalRevenueCashBasis || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>تكلفة البضاعة المباعة</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.totalCOGSCashBasis || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#ecfeff', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#0891b2', fontWeight: 500 }}>الربح الإجمالي</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: (data.grossProfitCashBasis || 0) >= 0 ? '#0891b2' : '#dc2626' }}>{formatNumber(data.grossProfitCashBasis || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: (data.netProfitCashBasis || 0) >= 0 ? '#dcfce7' : '#fee2e2', borderRadius: '12px', textAlign: 'center', border: '2px solid', borderColor: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626' }}>
                <div style={{ fontSize: '0.8rem', color: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626', fontWeight: 500 }}>صافي الربح المحصّل</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626' }}>{formatNumber(data.netProfitCashBasis || 0)}</div>
              </div>
            </div>
          </div>

          {/* (2) Accrual P&L — the accounting standard. Headline net + margin
              shown; the 7-figure breakdown collapsed behind a toggle. */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px', borderRight: '4px solid #3b82f6' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px', color: '#1e293b' }}>
              الأرباح والخسائر — بعد التسليم (استحقاق)
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 400, marginBottom: '16px' }}>
              اعتراف بالإيراد عند تسليم البضاعة — يشمل المبيعات المؤكدة فقط.
            </div>
            {(data.bonusSettledOutsideWindow || 0) > 0.005 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.75rem', color: '#92400e' }}>
                ملاحظة: عمولات بقيمة {formatNumber(data.bonusSettledOutsideWindow)}€ مستحقة في هذه الفترة لكن تسويتها تمت خارجها — غير مدرجة هنا. اختر فترة أوسع لرؤية الصورة الكاملة.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 600 }}>صافي الربح (استحقاق)</span>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: data.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                {formatNumber(data.netProfit)} <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>· هامش {netMargin}%</span>
              </span>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: '#1e40af', fontWeight: 600, marginBottom: 8 }}>عرض التفاصيل</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 500 }}>إيرادات مؤكدة ({data.confirmedCount || 0})</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.totalRevenue)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fee2e2', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>تكلفة البضاعة المباعة</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.totalCOGS)}</div>
              </div>
              <div style={{ padding: '16px', background: '#dbeafe', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#1e40af', fontWeight: 500 }}>الربح الإجمالي</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: data.grossProfit >= 0 ? '#1e40af' : '#dc2626' }}>{formatNumber(data.grossProfit)}</div>
                <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '4px' }}>هامش: {grossMargin}%</div>
              </div>
              <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#d97706', fontWeight: 500 }}>المصاريف التشغيلية</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309' }}>{formatNumber(data.totalExpenses)}</div>
              </div>
              <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 500 }}>عمولات تم صرفها</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.totalBonusPaid || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fee2e2', borderRadius: '12px', textAlign: 'center', border: (data.totalBonusOwed || 0) > 0 ? '2px solid #dc2626' : 'none' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>عمولات مستحقة (لازم تدفعها)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.totalBonusOwed || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: data.netProfit >= 0 ? '#dcfce7' : '#fee2e2', borderRadius: '12px', textAlign: 'center', border: '2px solid', borderColor: data.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                <div style={{ fontSize: '0.8rem', color: data.netProfit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 500 }}>صافي الربح (استحقاق)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: data.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>{formatNumber(data.netProfit)}</div>
                <div style={{ fontSize: '0.75rem', color: data.netProfit >= 0 ? '#16a34a' : '#dc2626', marginTop: '4px' }}>هامش: {netMargin}%</div>
              </div>
            </div>
            </details>
          </div>

          {/* (3) Projected (pipeline) P&L — tentative (reserved + confirmed);
              least certain, so it comes last. Collapsed to its headline. */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px', borderRight: '4px solid #8b5cf6' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px', color: '#6d28d9' }}>
              الأرباح والخسائر — المتوقعة
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '16px' }}>
              محجوز + مؤكد — مؤشر تقديري قابل للتغير مع الإلغاءات. عمولات الطلبات المحجوزة غير مدرجة (تُنشأ عند التوصيل).
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: '0.9rem', color: '#6d28d9', fontWeight: 600 }}>صافي الربح المتوقع</span>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: (data.projectedNetProfit || 0) >= 0 ? '#8b5cf6' : '#dc2626' }}>{formatNumber(data.projectedNetProfit || 0)}</span>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: '#6d28d9', fontWeight: 600, marginBottom: 8 }}>عرض التفاصيل</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', background: '#ede9fe', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#6d28d9', fontWeight: 500 }}>إيرادات متوقعة ({(data.confirmedCount || 0) + (data.reservedCount || 0)})</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#5b21b6' }}>{formatNumber(data.projectedRevenue || 0)}</div>
                <div style={{ fontSize: '0.7rem', color: '#8b5cf6', marginTop: '4px' }}>
                  محجوز: {formatNumber(data.reservedRevenue || 0)} • مؤكد: {formatNumber(data.totalRevenue || 0)}
                </div>
              </div>
              <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>تكلفة البضاعة (متوقع)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.projectedCOGS || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#f3e8ff', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#7e22ce', fontWeight: 500 }}>الربح الإجمالي المتوقع</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: (data.projectedGrossProfit || 0) >= 0 ? '#7e22ce' : '#dc2626' }}>{formatNumber(data.projectedGrossProfit || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#d97706', fontWeight: 500 }}>المصاريف</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309' }}>{formatNumber(data.totalExpenses || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fee2e2', borderRadius: '12px', textAlign: 'center', position: 'relative' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>عمولات (المؤكد فقط)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.totalBonusCost || 0)}</div>
                <div style={{ fontSize: '0.65rem', color: '#dc2626', marginTop: '4px' }}>لا تشمل المحجوز</div>
              </div>
              <div style={{ padding: '16px', background: (data.projectedNetProfit || 0) >= 0 ? '#ede9fe' : '#fee2e2', borderRadius: '12px', textAlign: 'center', border: '2px solid', borderColor: (data.projectedNetProfit || 0) >= 0 ? '#8b5cf6' : '#dc2626' }}>
                <div style={{ fontSize: '0.8rem', color: (data.projectedNetProfit || 0) >= 0 ? '#6d28d9' : '#dc2626', fontWeight: 500 }}>صافي الربح المتوقع</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: (data.projectedNetProfit || 0) >= 0 ? '#8b5cf6' : '#dc2626' }}>{formatNumber(data.projectedNetProfit || 0)}</div>
              </div>
            </div>
            </details>
          </div>

          {/* FEAT-04: Pending collections + period VAT widget */}
          {((data.pendingRevenue || 0) > 0 || (data.totalVatCollected || 0) > 0) && (
            <div className="card" style={{ marginBottom: '24px', padding: '20px', borderRight: '4px solid #f59e0b' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', color: '#92400e' }}>
                التحصيلات والضريبة
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 500 }}>المبلغ المستحق التحصيل ({data.partialSalesCount || 0})</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#b45309' }}>{formatNumber(data.pendingRevenue || 0)}</div>
                  <div style={{ fontSize: '0.7rem', color: '#92400e', marginTop: '4px' }}>
                    TVA ضمن المتبقي: {formatNumber(data.pendingTva || 0)}
                  </div>
                </div>
                <div style={{ padding: '16px', background: '#ede9fe', borderRadius: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.8rem', color: '#6d28d9', fontWeight: 500 }}>TVA محصّلة في الفترة</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#5b21b6' }}>{formatNumber(data.totalVatCollected || 0)}</div>
                  <div style={{ fontSize: '0.7rem', color: '#6d28d9', marginTop: '4px' }}>
                    من المدفوعات فعلياً
                  </div>
                </div>
              </div>
            </div>
          )}

            </>
          )}

          {/* ===== Tab 3: التقارير — charts, category/stock breakdown, tables ===== */}
          {activeTab === 'reports' && (
            <>
          {/* Period summary — quick headline numbers for the selected range,
              so the Reports tab opens with the totals before the charts. */}
          <div className="today-strip" style={{ marginBottom: 16 }}>
            <div className="today-item" style={{ borderTop: '3px solid #16a34a' }}>
              <span className="today-label">إجمالي المبيعات (مؤكد)</span>
              <span className="today-value">{formatNumber(data.totalRevenue || 0)}</span>
            </div>
            <div className="today-item" style={{ borderTop: '3px solid #dc2626' }}>
              <span className="today-label">إجمالي المشتريات</span>
              <span className="today-value">{formatNumber(data.totalPurchases || 0)}</span>
            </div>
            <div className="today-item" style={{ borderTop: '3px solid #f59e0b' }}>
              <span className="today-label">إجمالي المصاريف</span>
              <span className="today-value">{formatNumber(data.totalExpenses || 0)}</span>
            </div>
            <div className="today-item" style={{ borderTop: '3px solid #6366f1' }}>
              <span className="today-label">عدد المبيعات المؤكدة</span>
              <span className="today-value">{data.confirmedCount || 0}</span>
            </div>
          </div>
          {/* Charts */}
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
            مخطّط «المبيعات مقابل المشتريات» يعرض آخر 6 شهور دائماً (مستقل عن الفلتر الزمني أعلى الصفحة).
          </p>
          <div className="charts-grid">
            {/* Bar Chart - Monthly Sales vs Purchases */}
            <div className="chart-card">
              <h3>المبيعات مقابل المشتريات (آخر 6 شهور)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatNumber(value)} />
                  <Legend />
                  <Bar dataKey="sales" name="المبيعات" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" name="المشتريات" fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie Chart - Expense Breakdown */}
            <div className="chart-card">
              <h3>توزيع المصاريف بالفئة</h3>
              {pieData.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px' }}><h3>لا توجد مصاريف</h3></div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={false}
                      outerRadius={90}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatNumber(value)} />
                    {/* Bottom legend instead of overlapping outer labels — readable on mobile */}
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Profit-trend line chart moved to the «ملخص سريع» tab. */}
          </div>

          {/* DONE: Step 8 — inventory breakdown by category (admin/manager only) */}
          {canSeeCosts && categoryBreakdown.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                المخزون حسب الفئة
              </h3>
              <DataCardList
                rows={categoryBreakdown}
                fields={[
                  { key: 'category', label: 'الفئة' },
                  { key: 'count', label: 'عدد المنتجات' },
                  { key: 'totalStock', label: 'إجمالي القطع', format: (v) => formatNumber(v) },
                  { key: 'totalValue', label: 'قيمة المخزون', format: (v) => formatNumber(v) },
                  { key: 'lowCount', label: 'منخفض' },
                  { key: 'outCount', label: 'نفذ' },
                ]}
                emptyMessage="لا يوجد مخزون"
              />
              <div className="table-container has-card-fallback">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الفئة</th>
                      <th>عدد المنتجات</th>
                      <th>إجمالي القطع</th>
                      <th>قيمة المخزون</th>
                      <th>منخفض</th>
                      <th>نفذ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryBreakdown.map((c) => (
                      <tr key={c.category}>
                        <td style={{ fontWeight: 600 }}>{c.category}</td>
                        <td className="number-cell">{c.count}</td>
                        <td className="number-cell">{formatNumber(c.totalStock)}</td>
                        <td className="number-cell" style={{ color: '#4f46e5', fontWeight: 600 }}>{formatNumber(c.totalValue)}</td>
                        <td className="number-cell" style={{ color: c.lowCount > 0 ? '#d97706' : '#94a3b8' }}>{c.lowCount}</td>
                        <td className="number-cell" style={{ color: c.outCount > 0 ? '#dc2626' : '#94a3b8' }}>{c.outCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Debtors */}
          {data.topDebtors?.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                أعلى المدينين
              </h3>
              <DataCardList
                rows={data.topDebtors}
                fields={[
                  { key: 'name', label: 'اسم العميل' },
                  { key: 'debt', label: 'الدين المتبقي', format: (v) => formatNumber(v) },
                ]}
                emptyMessage="لا يوجد مدينون"
              />
              <div className="table-container has-card-fallback">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>اسم العميل</th>
                      <th>الدين المتبقي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topDebtors.map((debtor, i) => (
                      <tr key={debtor.name}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{debtor.name}</td>
                        <td className="number-cell" style={{ color: '#dc2626', fontWeight: 600 }}>{formatNumber(debtor.debt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* DONE: Fix 1 — top products by revenue */}
          {data.topProducts?.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                أكثر المنتجات مبيعاً
              </h3>
              <DataCardList
                rows={data.topProducts}
                fields={[
                  { key: 'item', label: 'المنتج' },
                  { key: 'count', label: 'الكمية', format: (v) => formatNumber(v) },
                  { key: 'revenue', label: 'الإيرادات', format: (v) => formatNumber(v) },
                  ...(canSeeCosts ? [{ key: 'profit', label: 'الربح', format: (v) => formatNumber(v) }] : []),
                ]}
                emptyMessage="لا توجد مبيعات"
              />
              <div className="table-container has-card-fallback">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>المنتج</th>
                      <th>الكمية</th>
                      <th>الإيرادات</th>
                      {canSeeCosts && <th>الربح</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p, i) => (
                      <tr key={p.item}>
                        <td style={{ fontWeight: 700, color: i < 3 ? '#f59e0b' : '#94a3b8' }}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                        </td>
                        <td style={{ fontWeight: 600 }}>{p.item}</td>
                        <td className="number-cell">{formatNumber(p.count)}</td>
                        <td className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>{formatNumber(p.revenue)}</td>
                        {canSeeCosts && (
                          <td className="number-cell" style={{ color: p.profit >= 0 ? '#1e40af' : '#dc2626', fontWeight: 600 }}>
                            {formatNumber(p.profit)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* v1.0.1 Feature 5 — top sellers replaces top clients per user request.
              Sources:
              - topSellers[] from getSummaryData (only users whose role is
                literally 'seller' are counted; admin/manager-created sales
                do NOT appear here, matching the locked bonus eligibility rule)
              - each entry shows sales count, total revenue, and accrued
                seller bonuses for the period
              The legacy topClients field is still returned from the API for
              backward compat with any external consumer, just not rendered. */}
          {data.topSellers?.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                أفضل البائعين
              </h3>
              <DataCardList
                rows={data.topSellers}
                fields={[
                  { key: 'name', label: 'البائع', format: (v, row) => v || row.username },
                  { key: 'salesCount', label: 'عدد المبيعات' },
                  { key: 'totalSales', label: 'إجمالي المبيعات', format: (v) => formatNumber(v) },
                  ...(canSeeCosts ? [{ key: 'totalBonus', label: 'العمولة المستحقة', format: (v) => formatNumber(v) }] : []),
                ]}
                emptyMessage="لا يوجد بائعون"
              />
              <div className="table-container has-card-fallback">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>البائع</th>
                      <th>عدد المبيعات</th>
                      <th>إجمالي المبيعات</th>
                      {canSeeCosts && <th>العمولة المستحقة</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.topSellers.map((s, i) => (
                      <tr key={s.username}>
                        <td style={{ fontWeight: 700, color: i < 3 ? '#f59e0b' : '#94a3b8' }}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                        </td>
                        <td style={{ fontWeight: 600 }}>{s.name || s.username}</td>
                        <td className="number-cell">{s.salesCount}</td>
                        <td className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>
                          {formatNumber(s.totalSales)}
                        </td>
                        {canSeeCosts && (
                          <td className="number-cell" style={{ color: '#7c3aed', fontWeight: 600 }}>
                            {formatNumber(s.totalBonus)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* v1.0.2 Feature 3 — supplier performance with total / paid /
              remaining columns, mirroring the v1.0.1 supplier credit flow.
              Remaining is red when > 0 (outstanding debt to supplier),
              green when fully settled. */}
          {isAdmin && data.topSuppliers?.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                أداء الموردين
              </h3>
              <DataCardList
                rows={data.topSuppliers}
                fields={[
                  { key: 'name', label: 'المورد' },
                  { key: 'orders', label: 'الطلبات' },
                  { key: 'itemCount', label: 'الأنواع' },
                  { key: 'totalSpent', label: 'إجمالي', format: (v) => formatNumber(v) },
                  { key: 'totalPaid', label: 'مدفوع', format: (v) => formatNumber(v) },
                  { key: 'totalRemaining', label: 'متبقي', format: (v) => formatNumber(v) },
                ]}
                emptyMessage="لا يوجد موردون"
              />
              <div className="table-container has-card-fallback">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>المورد</th>
                      <th>الطلبات</th>
                      <th>الأنواع</th>
                      <th>إجمالي</th>
                      <th>مدفوع</th>
                      <th>متبقي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topSuppliers.map((s) => {
                      const remaining = parseFloat(s.totalRemaining) || 0;
                      return (
                        <tr key={s.name}>
                          <td style={{ fontWeight: 600 }}>{s.name}</td>
                          <td className="number-cell">{s.orders}</td>
                          <td className="number-cell">{s.itemCount}</td>
                          <td className="number-cell" style={{ fontWeight: 600 }}>
                            {formatNumber(s.totalSpent)}
                          </td>
                          <td className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>
                            {formatNumber(s.totalPaid)}
                          </td>
                          <td className="number-cell" style={{
                            color: remaining > 0.005 ? '#dc2626' : '#16a34a',
                            fontWeight: 700,
                          }}>
                            {formatNumber(remaining)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
            </>
          )}

          {/* Cross-navigation */}
          <div className="cross-nav" style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '24px', marginBottom: '24px', flexWrap: 'wrap' }}>
            <a href="/sales" className="btn btn-outline btn-sm">المبيعات &rarr;</a>
            <a href="/purchases" className="btn btn-outline btn-sm">المشتريات &rarr;</a>
            <a href="/expenses" className="btn btn-outline btn-sm">المصاريف &rarr;</a>
          </div>
        </>
      ) : fetchError ? (
        /* v1.1 F-022 — explicit error state with retry button instead of
           silently rendering the empty state on API failure */
        <div className="empty-state">
          <h3 style={{ color: '#dc2626' }}>خطأ في جلب البيانات</h3>
          <p style={{ color: '#64748b', margin: '8px 0 16px' }}>
            تعذّر الاتصال بالخادم. تحقق من الشبكة وأعد المحاولة.
          </p>
          <button className="btn btn-primary" onClick={() => fetchData(dateFrom, dateTo)}>
            🔄 إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="empty-state">
          <h3>لا توجد بيانات</h3>
          <p style={{ color: '#64748b', marginTop: '8px' }}>أضف عمليات بيع وشراء لعرض الملخص المالي</p>
        </div>
      )}
    </AppLayout>
  );
}

export default function SummaryPage() {
  return (
    <ToastProvider>
      <SummaryContent />
    </ToastProvider>
  );
}
