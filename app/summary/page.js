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

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '20px' }}>
        <Link href="/sales" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#16a34a', color: 'white', borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 600, fontFamily: "'Cairo', sans-serif" }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            عملية بيع
          </div>
        </Link>
        {['admin', 'manager'].includes(session?.user?.role) && (
          <Link href="/purchases" style={{ textDecoration: 'none' }}>
            <div style={{ background: '#1e40af', color: 'white', borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 600, fontFamily: "'Cairo', sans-serif" }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              عملية شراء
            </div>
          </Link>
        )}
        {canUseVoice && process.env.NEXT_PUBLIC_VOICE_ENABLED !== 'false' && (
          <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <VoiceButton
              onResult={(r) => setVoiceResult(r)}
              onError={(e) => addToast(e, 'error')}
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.3 }}>إدخال صوتي</span>
          </div>
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

      {/* Date Filters — hidden for seller view (their data is all-time) */}
      {!isSellerView && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="filters-bar">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span style={{ color: '#64748b' }}>إلى</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={handleFilter}>تصفية</button>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn btn-outline btn-sm" onClick={() => handlePreset('thisMonth')}>هذا الشهر</button>
              <button className="btn btn-outline btn-sm" onClick={() => handlePreset('lastMonth')}>الشهر الماضي</button>
              <button className="btn btn-outline btn-sm" onClick={() => handlePreset('thisYear')}>هذه السنة</button>
              <button className="btn btn-outline btn-sm" onClick={() => handlePreset('all')}>الكل</button>
            </div>
            {/* DONE: Fix 4 — CSV export button (admin/manager only) */}
            {data && canSeeCosts && (
              <button
                className="btn btn-outline btn-sm"
                onClick={exportCSV}
                style={{ marginRight: 'auto' }}
              >
                📥 تصدير CSV
              </button>
            )}
          </div>
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
              {/* Quick KPI summary from both accrual and cash bases */}
              <div className="summary-cards">
                <div className="summary-card">
                  <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="summary-card-content">
                    <h3>إيرادات مؤكدة (استحقاق)</h3>
                    <div className="value" style={{ color: '#16a34a' }}>{formatNumber(data.totalRevenue)}</div>
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-card-icon" style={{ background: '#e0f2fe' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#0369a1" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
                  </div>
                  <div className="summary-card-content">
                    <h3>صافي الربح (محصّل)</h3>
                    <div className="value" style={{ color: (data.netProfitCashBasis || 0) >= 0 ? '#0ea5e9' : '#dc2626' }}>{formatNumber(data.netProfitCashBasis || 0)}</div>
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-card-icon" style={{ background: data.netProfit >= 0 ? '#dcfce7' : '#fee2e2' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={data.netProfit >= 0 ? '#16a34a' : '#dc2626'} width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
                  </div>
                  <div className="summary-card-content">
                    <h3>صافي الربح (استحقاق)</h3>
                    <div className="value" style={{ color: data.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>{formatNumber(data.netProfit)}</div>
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-card-icon" style={{ background: '#fee2e2' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#dc2626" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                  </div>
                  <div className="summary-card-content">
                    <h3>الديون المستحقة</h3>
                    <div className="value" style={{ color: '#dc2626' }}>{formatNumber(data.totalDebt)}</div>
                  </div>
                </div>
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

              {/* Cash vs Bank Breakdown */}
              <div className="card" style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                  تفصيل نقدي / بنك
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                  <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: '0.8rem', color: '#16a34a', marginBottom: '4px' }}>مبيعات كاش (COD)</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.salesCash || 0)}</div>
                  </div>
                  <div style={{ padding: '16px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: '0.8rem', color: '#2563eb', marginBottom: '4px' }}>مبيعات بنك</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1d4ed8' }}>{formatNumber(data.salesBank || 0)}</div>
                  </div>
                  <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fecaca' }}>
                    <div style={{ fontSize: '0.8rem', color: '#dc2626', marginBottom: '4px' }}>مشتريات كاش</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.purchasesCash || 0)}</div>
                  </div>
                  <div style={{ padding: '16px', background: '#fdf4ff', borderRadius: '12px', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontSize: '0.8rem', color: '#7c3aed', marginBottom: '4px' }}>مشتريات بنك</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#6d28d9' }}>{formatNumber(data.purchasesBank || 0)}</div>
                  </div>
                  <div style={{ padding: '16px', background: '#fffbeb', borderRadius: '12px', border: '1px solid #fde68a' }}>
                    <div style={{ fontSize: '0.8rem', color: '#d97706', marginBottom: '4px' }}>مصاريف كاش</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#b45309' }}>{formatNumber(data.expensesCash || 0)}</div>
                  </div>
                  <div style={{ padding: '16px', background: '#f0f9ff', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                    <div style={{ fontSize: '0.8rem', color: '#0284c7', marginBottom: '4px' }}>مصاريف بنك</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0369a1' }}>{formatNumber(data.expensesBank || 0)}</div>
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
                            <td>{d.date}</td>
                            <td style={{ fontWeight: 600 }}>{d.client_name}</td>
                            <td>{d.address}</td>
                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.items}</td>
                            <td>
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
