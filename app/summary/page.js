'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber, PRODUCT_CATEGORIES } from '@/lib/utils';
import Link from 'next/link';
import VoiceButton from '@/components/VoiceButton';
import VoiceConfirm from '@/components/VoiceConfirm';
import PageSkeleton from '@/components/PageSkeleton';
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
    } catch (err) {
      // v1.1 F-022 — set fetchError so the render shows a retry button
      // instead of silently rendering the empty state.
      setFetchError(true);
      addToast('خطأ في جلب البيانات — اضغط "إعادة المحاولة" أدناه', 'error');
    } finally {
      setLoading(false);
    }
  };

  // DONE: Fix 4 — CSV export of the P&L summary, BOM-prefixed for correct Arabic in Excel
  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ['البند', 'المبلغ'],
      ['إيرادات مؤكدة (استحقاق)', data.totalRevenue],
      ['تكلفة البضاعة المباعة (استحقاق)', data.totalCOGS],
      ['الربح الإجمالي (استحقاق)', data.grossProfit],
      ['المصاريف التشغيلية', data.totalExpenses],
      ['عمولات مدفوعة', data.totalBonusPaid],
      ['عمولات مستحقة', data.totalBonusOwed],
      ['صافي الربح (استحقاق)', data.netProfit],
      [''],
      ['إجمالي المشتريات', data.totalPurchases],
      ['قيمة المخزون', data.inventoryValue],
      ['الديون المستحقة', data.totalDebt],
      [''],
      ['مبيعات كاش', data.salesCash],
      ['مبيعات بنك', data.salesBank],
      ['مبيعات آجل', data.salesCredit],
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

  // DONE: Fix 6 — gross + net margin (used inside the P&L cards)
  const grossMargin = data && data.totalRevenue > 0
    ? ((data.grossProfit / data.totalRevenue) * 100).toFixed(1)
    : '0';
  const netMargin = data && data.totalRevenue > 0
    ? ((data.netProfit / data.totalRevenue) * 100).toFixed(1)
    : '0';

  // DONE: Step 8 — category breakdown computed from the product list
  const categoryBreakdown = canSeeCosts
    ? PRODUCT_CATEGORIES.map((cat) => {
        const items = productList.filter((p) => p.category === cat);
        return {
          category: cat,
          count: items.length,
          // ARC-06: NUMERIC columns arrive as strings. `!p.stock` would be
          // true for null but FALSE for "0.00" (non-empty string is truthy),
          // so the outCount filter uses a numeric comparison instead.
          totalStock: items.reduce((s, p) => s + (parseFloat(p.stock) || 0), 0),
          totalValue: items.reduce((s, p) => s + ((parseFloat(p.stock) || 0) * (parseFloat(p.buy_price) || 0)), 0),
          lowCount: items.filter((p) => (parseFloat(p.stock) || 0) > 0 && (parseFloat(p.stock) || 0) <= (p.low_stock_threshold ?? 3)).length,
          outCount: items.filter((p) => (parseFloat(p.stock) || 0) <= 0).length,
        };
      }).filter((c) => c.count > 0)
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

  const exportData = data ? [
    { 'البند': 'إيرادات المبيعات (استحقاق)', 'المبلغ': data.totalRevenue },
    { 'البند': 'تكلفة البضاعة المباعة (استحقاق)', 'المبلغ': data.totalCOGS },
    { 'البند': 'الربح الإجمالي (استحقاق)', 'المبلغ': data.grossProfit },
    { 'البند': 'المصاريف التشغيلية', 'المبلغ': data.totalExpenses },
    { 'البند': 'صافي الربح (استحقاق)', 'المبلغ': data.netProfit },
    { 'البند': 'إجمالي المشتريات', 'المبلغ': data.totalPurchases },
    { 'البند': 'قيمة المخزون', 'المبلغ': data.inventoryValue },
    { 'البند': 'الديون المستحقة', 'المبلغ': data.totalDebt },
    { 'البند': 'مبيعات كاش (COD)', 'المبلغ': data.salesCash },
    { 'البند': 'مبيعات بنك', 'المبلغ': data.salesBank },
  ] : [];

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
      {!isSellerView && (
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
      {!isSellerView && showCustomDate && (
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
              {/* KPI Cards — new design with colored borders */}
              <div className="kpi-grid">
                {[
                  { label: 'إيرادات مؤكدة (استحقاق)', value: data.totalRevenue, icon: '💎', color: '#10b981' },
                  { label: 'صافي الربح (محصّل)', value: data.netProfitCashBasis || 0, icon: '📊', color: '#6366f1' },
                  { label: 'صافي الربح (استحقاق)', value: data.netProfit, icon: '📈', color: '#3b82f6' },
                  { label: 'الديون المستحقة', value: data.totalDebt, icon: '⚠️', color: '#f43f5e' },
                ].map((kpi, i) => {
                  const num = parseFloat(kpi.value) || 0;
                  return (
                    <div key={i} className="kpi-card" style={{ borderRight: `3px solid ${kpi.color}`, animationDelay: `${i * 0.07}s` }}>
                      <div className="kpi-top">
                        <span style={{ fontSize: 24 }}>{kpi.icon}</span>
                        <span className="kpi-label">{kpi.label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span className="kpi-value" style={{ color: num === 0 ? '#cbd5e1' : kpi.color }}>
                          {num === 0 ? '—' : formatNumber(num)}
                        </span>
                        {num === 0 && <span className="kpi-empty">لا بيانات</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reserved Orders */}
              {(data.reservedCount > 0) && (
                <div className="card" style={{ marginBottom: '24px', padding: '16px', borderRight: '4px solid #f59e0b' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>طلبات محجوزة (بانتظار التوصيل)</h3>
                      <span style={{ fontSize: '0.85rem', color: '#a16207' }}>{data.reservedCount} طلب بقيمة {formatNumber(data.reservedRevenue)} - ربح متوقع: {formatNumber(data.reservedProfit)}</span>
                    </div>
                    <span className="status-badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.9rem', padding: '6px 16px' }}>
                      لم تُحسب في الأرباح
                    </span>
                  </div>
                </div>
              )}

              {/* Cash vs Bank — Table Format */}
              <div className="section-header">
                <span style={{ fontSize: 18 }}>💳</span>
                <span>تفصيل نقدي / بنك</span>
              </div>
              <div className="cash-table" style={{ marginBottom: 24 }}>
                <div className="cash-header">
                  <div className="cash-col"></div>
                  <div className="cash-col cash-col-header"><span style={{ color: '#10b981' }}>●</span> كاش</div>
                  <div className="cash-col cash-col-header"><span style={{ color: 'var(--color-accent)' }}>●</span> بنك</div>
                </div>
                {[
                  { label: 'مبيعات', cash: data.salesCash || 0, bank: data.salesBank || 0 },
                  { label: 'مشتريات', cash: data.purchasesCash || 0, bank: data.purchasesBank || 0 },
                  { label: 'مصاريف', cash: data.expensesCash || 0, bank: data.expensesBank || 0 },
                ].map((row, i) => (
                  <div key={i} className="cash-row" style={{ background: i % 2 === 0 ? 'rgba(99,102,241,0.03)' : 'transparent' }}>
                    <div className="cash-col cash-col-label">{row.label}</div>
                    <div className="cash-col">
                      {row.cash > 0
                        ? <span className="cash-highlight">{formatNumber(row.cash)}</span>
                        : <span className="cash-zero">—</span>}
                    </div>
                    <div className="cash-col">
                      {row.bank > 0
                        ? <span style={{ fontWeight: 700 }}>{formatNumber(row.bank)}</span>
                        : <span className="cash-zero">—</span>}
                    </div>
                  </div>
                ))}
                <div className="cash-total-row">
                  <div className="cash-col" style={{ fontWeight: 700 }}>الإجمالي</div>
                  <div className="cash-col">
                    <span style={{ fontWeight: 700, color: '#10b981' }}>
                      {formatNumber((data.salesCash || 0) + (data.purchasesCash || 0) + (data.expensesCash || 0))}
                    </span>
                  </div>
                  <div className="cash-col">
                    <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>
                      {formatNumber((data.salesBank || 0) + (data.purchasesBank || 0) + (data.expensesBank || 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pending Deliveries */}
              {data.recentDeliveries?.length > 0 && (
                <div className="card" style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#f59e0b" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                    </svg>
                    التوصيلات المعلقة والجارية
                  </h3>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>العميل</th>
                          <th>العنوان</th>
                          <th>الأصناف</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentDeliveries.map((d, i) => (
                          <tr key={i}>
                            <td data-label="التاريخ">{d.date}</td>
                            <td data-label="العميل" style={{ fontWeight: 600 }}>{d.client_name}</td>
                            <td data-label="العنوان">{d.address}</td>
                            <td data-label="الأصناف" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.items}</td>
                            <td data-label="الحالة">
                              <span style={{
                                padding: '2px 10px',
                                borderRadius: '20px',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                background: d.status === 'قيد الانتظار' ? '#fef3c7' : '#dbeafe',
                                color: d.status === 'قيد الانتظار' ? '#d97706' : '#3b82f6',
                              }}>
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
            </>
          )}

          {/* ===== Tab 2: الأرباح والخسائر — P&L detailed cards ===== */}
          {activeTab === 'pnl' && (
            <>
          {/* Accounting P&L Cards */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', color: '#1e293b' }}>
              قائمة الأرباح والخسائر (استحقاق)
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 400, marginRight: '8px' }}>(المبيعات المؤكدة بعد التوصيل فقط)</span>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 500 }}>إيرادات مؤكدة (استحقاق) ({data.confirmedCount || 0})</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.totalRevenue)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fee2e2', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>تكلفة البضاعة المباعة (استحقاق)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.totalCOGS)}</div>
              </div>
              <div style={{ padding: '16px', background: '#dbeafe', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#1e40af', fontWeight: 500 }}>الربح الإجمالي (استحقاق)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: data.grossProfit >= 0 ? '#1e40af' : '#dc2626' }}>{formatNumber(data.grossProfit)}</div>
                {/* DONE: Fix 6 — gross profit margin */}
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
                {/* DONE: Fix 6 — net profit margin */}
                <div style={{ fontSize: '0.75rem', color: data.netProfit >= 0 ? '#16a34a' : '#dc2626', marginTop: '4px' }}>هامش: {netMargin}%</div>
              </div>
            </div>
          </div>

          {/* FEAT-04: Cash-basis P&L card. Displays revenue/COGS/gross/net
              computed ONLY from fully-paid sales (payment_status = 'paid').
              Shown alongside the accrual P&L above so the user can see
              both "what I booked" and "what I actually collected". */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px', borderRight: '4px solid #0ea5e9' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px', color: '#0369a1' }}>
              قائمة الأرباح والخسائر (محصّل)
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '16px' }}>
              (المبيعات المحصّلة بالكامل فقط — الصفقات الجزئية لا تُحتسب حتى تُدفع بالكامل)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', background: '#e0f2fe', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 500 }}>إيرادات محصّلة (محصّل) ({data.paidSalesCount || 0})</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#075985' }}>{formatNumber(data.totalRevenueCashBasis || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 500 }}>تكلفة المحصّل (محصّل)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.totalCOGSCashBasis || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#ecfeff', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#0891b2', fontWeight: 500 }}>الربح الإجمالي (محصّل)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: (data.grossProfitCashBasis || 0) >= 0 ? '#0891b2' : '#dc2626' }}>{formatNumber(data.grossProfitCashBasis || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: (data.netProfitCashBasis || 0) >= 0 ? '#dcfce7' : '#fee2e2', borderRadius: '12px', textAlign: 'center', border: '2px solid', borderColor: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626' }}>
                <div style={{ fontSize: '0.8rem', color: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626', fontWeight: 500 }}>صافي الربح (محصّل)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626' }}>{formatNumber(data.netProfitCashBasis || 0)}</div>
              </div>
            </div>
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
          {/* Charts */}
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
                      labelLine={true}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      outerRadius={100}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatNumber(value)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Line Chart - Profit Trend */}
            <div className="chart-card">
              <h3>اتجاه صافي الربح</h3>
              <ResponsiveContainer width="100%" height={300}>
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
          </div>

          {/* DONE: Step 8 — inventory breakdown by category (admin/manager only) */}
          {canSeeCosts && categoryBreakdown.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                المخزون حسب الفئة
              </h3>
              <div className="table-container">
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
                        <td data-label="الفئة" style={{ fontWeight: 600 }}>{c.category}</td>
                        <td data-label="عدد المنتجات" className="number-cell">{c.count}</td>
                        <td data-label="إجمالي القطع" className="number-cell">{formatNumber(c.totalStock)}</td>
                        <td data-label="قيمة المخزون" className="number-cell" style={{ color: '#4f46e5', fontWeight: 600 }}>{formatNumber(c.totalValue)}</td>
                        <td data-label="منخفض" className="number-cell" style={{ color: c.lowCount > 0 ? '#d97706' : '#94a3b8' }}>{c.lowCount}</td>
                        <td data-label="نفذ" className="number-cell" style={{ color: c.outCount > 0 ? '#dc2626' : '#94a3b8' }}>{c.outCount}</td>
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
              <div className="table-container">
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
                        <td data-label="الترتيب">{i + 1}</td>
                        <td data-label="اسم العميل" style={{ fontWeight: 600 }}>{debtor.name}</td>
                        <td data-label="الدين المتبقي" className="number-cell" style={{ color: '#dc2626', fontWeight: 600 }}>{formatNumber(debtor.debt)}</td>
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
              <div className="table-container">
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
                        <td data-label="الترتيب" style={{ fontWeight: 700, color: i < 3 ? '#f59e0b' : '#94a3b8' }}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                        </td>
                        <td data-label="المنتج" style={{ fontWeight: 600 }}>{p.item}</td>
                        <td data-label="الكمية" className="number-cell">{formatNumber(p.count)}</td>
                        <td data-label="الإيرادات" className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>{formatNumber(p.revenue)}</td>
                        {canSeeCosts && (
                          <td data-label="الربح" className="number-cell" style={{ color: p.profit >= 0 ? '#1e40af' : '#dc2626', fontWeight: 600 }}>
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
              <div className="table-container">
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
                        <td data-label="الترتيب" style={{ fontWeight: 700, color: i < 3 ? '#f59e0b' : '#94a3b8' }}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                        </td>
                        <td data-label="البائع" style={{ fontWeight: 600 }}>{s.name || s.username}</td>
                        <td data-label="عدد المبيعات" className="number-cell">{s.salesCount}</td>
                        <td data-label="إجمالي المبيعات" className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>
                          {formatNumber(s.totalSales)}
                        </td>
                        {canSeeCosts && (
                          <td data-label="العمولة المستحقة" className="number-cell" style={{ color: '#7c3aed', fontWeight: 600 }}>
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
              <div className="table-container">
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
                          <td data-label="المورد" style={{ fontWeight: 600 }}>{s.name}</td>
                          <td data-label="الطلبات" className="number-cell">{s.orders}</td>
                          <td data-label="الأنواع" className="number-cell">{s.itemCount}</td>
                          <td data-label="إجمالي" className="number-cell" style={{ fontWeight: 600 }}>
                            {formatNumber(s.totalSpent)}
                          </td>
                          <td data-label="مدفوع" className="number-cell" style={{ color: '#16a34a', fontWeight: 600 }}>
                            {formatNumber(s.totalPaid)}
                          </td>
                          <td data-label="متبقي" className="number-cell" style={{
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
