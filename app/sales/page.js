'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ExportExcel from '@/components/ExportExcel';
import ConfirmModal from '@/components/ConfirmModal';
import { formatNumber, getTodayDate } from '@/lib/utils';

function SalesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const [form, setForm] = useState({
    date: getTodayDate(),
    clientName: '',
    item: '',
    quantity: '',
    unitPrice: '',
    paymentMethod: 'نقدي',
    paidAmount: '',
    notes: '',
  });

  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitPrice) || 0);
  const paid = form.paymentMethod === 'نقدي' ? total : (parseFloat(form.paidAmount) || 0);
  const remaining = total - paid;

  const fetchData = async () => {
    try {
      const [salesRes, clientsRes, productsRes] = await Promise.all([
        fetch('/api/sales'),
        fetch('/api/clients'),
        fetch('/api/products'),
      ]);
      const salesData = await salesRes.json();
      const clientsData = await clientsRes.json();
      const productsData = await productsRes.json();
      setRows(Array.isArray(salesData) ? salesData.reverse() : []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.clientName || !form.item || !form.quantity || !form.unitPrice) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // Auto-create client if new
      const clientExists = clients.some((c) => c['اسم العميل'] === form.clientName);
      if (!clientExists) {
        await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.clientName }),
        });
      }

      // Auto-create product if new
      const productExists = products.some((p) => p['اسم المنتج'] === form.item);
      if (!productExists && form.item) {
        await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.item }),
        });
      }

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, paidAmount: paid }),
      });
      if (res.ok) {
        addToast('تم تسجيل عملية البيع بنجاح');
        setForm({ date: getTodayDate(), clientName: '', item: '', quantity: '', unitPrice: '', paymentMethod: 'نقدي', paidAmount: '', notes: '' });
        fetchData();
      } else {
        addToast('خطأ في إضافة البيانات', 'error');
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
      const res = await fetch(`/api/sales?id=${deleteId}`, { method: 'DELETE' });
      if (res.ok) {
        addToast('تم الحذف بنجاح');
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

  return (
    <AppLayout>
      <div className="page-header">
        <h2>بيع البضائع</h2>
        <p>تسجيل وإدارة عمليات البيع</p>
      </div>

      {/* Add Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          تسجيل عملية بيع جديدة
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>التاريخ *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>اسم العميل *</label>
              <input
                type="text"
                list="clients-list"
                value={form.clientName}
                onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                placeholder="اختر أو أدخل اسم العميل"
                required
              />
              <datalist id="clients-list">
                {clients.map((c) => <option key={c['معرف']} value={c['اسم العميل']} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label>اسم الصنف *</label>
              <input type="text" list="sales-products-list" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="اكتب للبحث أو أضف صنف جديد" required />
              <datalist id="sales-products-list">
                {products.map((p) => <option key={p['معرف']} value={p['اسم المنتج']} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label>الكمية *</label>
              <input type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label>سعر الوحدة *</label>
              <input type="number" min="0" step="any" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label>الإجمالي</label>
              <input type="text" value={formatNumber(total)} readOnly />
            </div>
            <div className="form-group">
              <label>طريقة الدفع *</label>
              <div className="radio-group" style={{ marginTop: '6px' }}>
                <label className="radio-option">
                  <input type="radio" name="payment" value="نقدي" checked={form.paymentMethod === 'نقدي'} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value, paidAmount: '' })} />
                  نقدي
                </label>
                <label className="radio-option">
                  <input type="radio" name="payment" value="آجل" checked={form.paymentMethod === 'آجل'} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} />
                  آجل (دين)
                </label>
              </div>
            </div>
            {form.paymentMethod === 'آجل' && (
              <>
                <div className="form-group">
                  <label>المبلغ المدفوع</label>
                  <input type="number" min="0" step="any" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} placeholder="0" />
                </div>
                <div className="form-group">
                  <label>المبلغ المتبقي</label>
                  <input type="text" value={formatNumber(remaining)} readOnly style={{ color: remaining > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }} />
                </div>
              </>
            )}
            <div className="form-group">
              <label>ملاحظات</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'جاري التسجيل...' : 'تسجيل عملية بيع'}
          </button>
        </form>
      </div>

      {/* Data Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المبيعات ({rows.length})
          </h3>
          {isAdmin && rows.length > 0 && (
            <ExportExcel data={rows} fileName="المبيعات" sheetName="المبيعات" />
          )}
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد مبيعات بعد</h3>
            <p>سجّل أول عملية بيع من النموذج أعلاه</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>التاريخ</th>
                  <th>العميل</th>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي</th>
                  <th>الدفع</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  {isAdmin && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row['معرف']}>
                    <td>{row['معرف']}</td>
                    <td>{row['التاريخ']}</td>
                    <td>{row['اسم العميل']}</td>
                    <td>{row['اسم الصنف']}</td>
                    <td className="number-cell">{formatNumber(row['الكمية'])}</td>
                    <td className="number-cell">{formatNumber(row['سعر الوحدة'])}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row['الإجمالي'])}</td>
                    <td>
                      <span className={`status-badge ${row['طريقة الدفع'] === 'نقدي' ? 'status-cash' : 'status-credit'}`}>
                        {row['طريقة الدفع']}
                      </span>
                    </td>
                    <td className="number-cell">{formatNumber(row['المبلغ المدفوع'])}</td>
                    <td className="number-cell" style={{ color: parseFloat(row['المبلغ المتبقي']) > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                      {formatNumber(row['المبلغ المتبقي'])}
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row['معرف'])}>
                          حذف
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        title="حذف عملية بيع"
        message="هل أنت متأكد من حذف هذه العملية؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AppLayout>
  );
}

export default function SalesPage() {
  return (
    <ToastProvider>
      <SalesContent />
    </ToastProvider>
  );
}
