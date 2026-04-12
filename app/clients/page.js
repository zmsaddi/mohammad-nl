'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { formatNumber } from '@/lib/utils';

function ClientsContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
  });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/clients?withDebt=true');
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name) {
      addToast('يرجى إدخال اسم العميل', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await res.json().catch(() => ({}));
      // DONE: Bug 9 — addClient() returns { ambiguous: true, candidates, message }
      // when the name already exists with no phone/email. Surface it to the user
      // and keep the form open so they can add a phone/email and retry.
      if (result?.ambiguous) {
        addToast(result.message || 'يوجد عميل بنفس الاسم — أضف رقم هاتف أو إيميل للتمييز', 'error');
        return;
      }
      if (res.ok) {
        addToast('تم إضافة العميل بنجاح');
        setForm({ name: '', phone: '', email: '', address: '', notes: '' });
        setShowForm(false);
        fetchData();
      } else {
        addToast(result?.error || 'خطأ في إضافة العميل', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/clients?id=${deleteId}`, { method: 'DELETE' });
      if (res.ok) {
        addToast('تم حذف العميل بنجاح');
        fetchData();
      } else {
        const data = await res.json();
        addToast(data.error || 'خطأ في الحذف', 'error');
      }
    } catch {
      addToast('خطأ في الاتصال', 'error');
    }
    setDeleteId(null);
  };

  const filtered = clients.filter((c) =>
    c.name?.includes(search) || c.phone?.includes(search)
  );

  const totalDebt = clients.reduce((sum, c) => sum + (c.remainingDebt || 0), 0);

  return (
    <AppLayout>
      <div className="page-header">
        <h2>بيانات العملاء</h2>
        <p>بيانات العملاء والديون المستحقة</p>
      </div>

      {/* Summary */}
      <div className="summary-cards" style={{ marginBottom: '24px' }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe', color: '#1e40af' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <div className="summary-card-content">
            <h3>عدد العملاء</h3>
            <div className="value">{clients.length}</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="summary-card-content">
            <h3>إجمالي الديون</h3>
            <div className="value" style={{ color: '#dc2626' }}>{formatNumber(totalDebt)}</div>
          </div>
        </div>
      </div>

      {/* Add Client Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
            إضافة عميل جديد
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="client-name">اسم العميل *</label>
                <input id="client-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="أدخل اسم العميل" required />
              </div>
              <div className="form-group">
                <label htmlFor="client-phone">رقم الهاتف</label>
                <input id="client-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+31612345678" style={{ direction: 'ltr', textAlign: 'right' }} />
              </div>
              <div className="form-group">
                <label htmlFor="client-email">الإيميل</label>
                <input id="client-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" style={{ direction: 'ltr', textAlign: 'right' }} />
              </div>
              <div className="form-group">
                <label htmlFor="client-address">العنوان</label>
                <input id="client-address" type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="العنوان الكامل" />
              </div>
              <div className="form-group">
                <label htmlFor="client-notes">ملاحظات</label>
                <input id="client-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'جاري الإضافة...' : 'إضافة عميل'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {/* Clients Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            قائمة العملاء
          </h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="بحث بالاسم أو الهاتف..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '8px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.85rem' }}
            />
            {!showForm && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
                + إضافة عميل
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <h3>{search ? 'لا توجد نتائج' : 'لا يوجد عملاء بعد'}</h3>
            <p>{search ? 'جرب كلمة بحث مختلفة' : 'أضف أول عميل بالضغط على زر الإضافة'}</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم العميل</th>
                  <th>رقم الهاتف</th>
                  <th>إجمالي المشتريات</th>
                  <th>المدفوع</th>
                  <th>الدين المتبقي</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((client) => (
                  <tr key={client.id}>
                    <td>{client.id}</td>
                    <td style={{ fontWeight: 600 }}>{client.name}</td>
                    <td>{client.phone}</td>
                    <td className="number-cell">{formatNumber(client.totalSales)}</td>
                    <td className="number-cell" style={{ color: '#16a34a' }}>{formatNumber(client.totalPaid)}</td>
                    <td className="number-cell" style={{ color: client.remainingDebt > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                      {formatNumber(client.remainingDebt)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <Link href={`/clients/${client.id}`} className="btn btn-primary btn-sm">
                          التفاصيل
                        </Link>
                        {isAdmin && (
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(client.id)}>
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف عميل"
        message="هل أنت متأكد من حذف هذا العميل؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AppLayout>
  );
}

export default function ClientsPage() {
  return (
    <ToastProvider>
      <ClientsContent />
    </ToastProvider>
  );
}
