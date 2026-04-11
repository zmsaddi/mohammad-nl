'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ExportExcel from '@/components/ExportExcel';
import { formatNumber } from '@/lib/utils';
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

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = async (from, to) => {
    setLoading(true);
    try {
      let url = '/api/summary';
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (params.toString()) url += `?${params}`;

      const res = await fetch(url);
      const result = await res.json();
      setData(result);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

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
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      from = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-01`;
      to = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth(), 0).getDate()}`;
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
    { 'البند': 'إيرادات المبيعات', 'المبلغ': data.totalRevenue },
    { 'البند': 'تكلفة البضاعة المباعة', 'المبلغ': data.totalCOGS },
    { 'البند': 'الربح الإجمالي', 'المبلغ': data.grossProfit },
    { 'البند': 'المصاريف التشغيلية', 'المبلغ': data.totalExpenses },
    { 'البند': 'صافي الربح', 'المبلغ': data.netProfit },
    { 'البند': 'رأس المال (المشتريات)', 'المبلغ': data.totalPurchases },
    { 'البند': 'قيمة المخزون', 'المبلغ': data.inventoryValue },
    { 'البند': 'الديون المستحقة', 'المبلغ': data.totalDebt },
    { 'البند': 'مبيعات نقدي', 'المبلغ': data.salesCash },
    { 'البند': 'مبيعات بنك', 'المبلغ': data.salesBank },
  ] : [];

  return (
    <AppLayout>
      <div className="page-header">
        <h2>لوحة التحكم</h2>
        <p>نظرة شاملة على أداء المتجر</p>
      </div>

      {/* Date Filters */}
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
          {isAdmin && data && (
            <ExportExcel data={exportData} fileName="تقرير_مالي" sheetName="الملخص" />
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="spinner"></div></div>
      ) : data ? (
        <>
          {/* Accounting P&L Cards */}
          <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', color: '#1e293b' }}>
              قائمة الأرباح والخسائر
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 400, marginRight: '8px' }}>(المبيعات المؤكدة بعد التوصيل فقط)</span>
            </h3>
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
              </div>
              <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#d97706', fontWeight: 500 }}>المصاريف التشغيلية</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309' }}>{formatNumber(data.totalExpenses)}</div>
              </div>
              <div style={{ padding: '16px', background: data.netProfit >= 0 ? '#dcfce7' : '#fee2e2', borderRadius: '12px', textAlign: 'center', border: '2px solid', borderColor: data.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                <div style={{ fontSize: '0.8rem', color: data.netProfit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 500 }}>صافي الربح</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: data.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>{formatNumber(data.netProfit)}</div>
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

          {/* Assets & Liabilities */}
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
              </div>
              <div className="summary-card-content">
                <h3>رأس المال (المشتريات)</h3>
                <div className="value">{formatNumber(data.totalPurchases)}</div>
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-icon" style={{ background: '#e0e7ff' }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#4f46e5" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
              </div>
              <div className="summary-card-content">
                <h3>قيمة المخزون</h3>
                <div className="value" style={{ color: '#4f46e5' }}>{formatNumber(data.inventoryValue)}</div>
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
            <div className="summary-card">
              <div className="summary-card-icon" style={{ background: '#fef3c7' }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#f59e0b" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="summary-card-content">
                <h3>توصيلات معلقة</h3>
                <div className="value" style={{ color: '#f59e0b' }}>{data.pendingDeliveries || 0}</div>
              </div>
            </div>
          </div>

          {/* Cash vs Bank Breakdown */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
              تفصيل نقدي / بنك
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '0.8rem', color: '#16a34a', marginBottom: '4px' }}>مبيعات نقدي</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#15803d' }}>{formatNumber(data.salesCash || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
                <div style={{ fontSize: '0.8rem', color: '#2563eb', marginBottom: '4px' }}>مبيعات بنك</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1d4ed8' }}>{formatNumber(data.salesBank || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', marginBottom: '4px' }}>مشتريات نقدي</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#b91c1c' }}>{formatNumber(data.purchasesCash || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fdf4ff', borderRadius: '12px', border: '1px solid #e9d5ff' }}>
                <div style={{ fontSize: '0.8rem', color: '#7c3aed', marginBottom: '4px' }}>مشتريات بنك</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#6d28d9' }}>{formatNumber(data.purchasesBank || 0)}</div>
              </div>
              <div style={{ padding: '16px', background: '#fffbeb', borderRadius: '12px', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: '0.8rem', color: '#d97706', marginBottom: '4px' }}>مصاريف نقدي</div>
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
                        <td>{d['التاريخ']}</td>
                        <td style={{ fontWeight: 600 }}>{d['اسم العميل']}</td>
                        <td>{d['العنوان']}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d['الأصناف']}</td>
                        <td>
                          <span style={{
                            padding: '2px 10px',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: d['الحالة'] === 'قيد الانتظار' ? '#fef3c7' : '#dbeafe',
                            color: d['الحالة'] === 'قيد الانتظار' ? '#d97706' : '#3b82f6',
                          }}>
                            {d['الحالة']}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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

          {/* Top Debtors */}
          {data.topDebtors?.length > 0 && (
            <div className="card">
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
        </>
      ) : (
        <div className="empty-state">
          <h3>لا توجد بيانات</h3>
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
