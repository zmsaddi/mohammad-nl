'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ExportExcel from '@/components/ExportExcel';
import ConfirmModal from '@/components/ConfirmModal';
import { formatNumber, getTodayDate } from '@/lib/utils';

function PurchasesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const isAdmin = session?.user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const [form, setForm] = useState({
    date: getTodayDate(),
    supplier: '',
    item: '',
    quantity: '',
    unitPrice: '',
    notes: '',
  });

  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitPrice) || 0);

  const fetchData = async () => {
    try {
      const [purchasesRes, productsRes, suppliersRes] = await Promise.all([
        fetch('/api/purchases'),
        fetch('/api/products'),
        fetch('/api/suppliers'),
      ]);
      const purchasesData = await purchasesRes.json();
      const productsData = await productsRes.json();
      const suppliersData = await suppliersRes.json();
      setRows(Array.isArray(purchasesData) ? purchasesData.reverse() : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
    } catch {
      addToast('خطأ في جلب البيانات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.supplier || !form.item || !form.quantity || !form.unitPrice) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // Auto-create product if new
      const productExists = products.some((p) => p['اسم المنتج'] === form.item);
      if (!productExists && form.item) {
        await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.item }),
        });
      }

      // Auto-create supplier if new
      const supplierExists = suppliers.some((s) => s['اسم المورد'] === form.supplier);
      if (!supplierExists && form.supplier) {
        await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.supplier }),
        });
      }

      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        addToast('تم إضافة عملية الشراء بنجاح');
        setForm({ date: getTodayDate(), supplier: '', item: '', quantity: '', unitPrice: '', notes: '' });
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
      const res = await fetch(`/api/purchases?id=${deleteId}`, { method: 'DELETE' });
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
        <h2>شراء البضائع</h2>
        <p>إضافة وإدارة عمليات الشراء</p>
      </div>

      {/* Add Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
          إضافة عملية شراء جديدة
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>التاريخ *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>اسم المورد *</label>
              <input
                type="text"
                list="suppliers-list"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                placeholder="اكتب للبحث أو أضف مورد جديد"
                required
              />
              <datalist id="suppliers-list">
                {suppliers.map((s) => <option key={s['معرف'] || s} value={s['اسم المورد'] || s} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label>اسم الصنف *</label>
              <input type="text" list="products-list" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="اكتب للبحث أو أضف صنف جديد" required />
              <datalist id="products-list">
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
              <label>ملاحظات</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'جاري الإضافة...' : 'إضافة عملية شراء'}
          </button>
        </form>
      </div>

      {/* Data Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
            سجل المشتريات ({rows.length})
          </h3>
          {isAdmin && rows.length > 0 && (
            <ExportExcel data={rows} fileName="المشتريات" sheetName="المشتريات" />
          )}
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner"></div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد مشتريات بعد</h3>
            <p>أضف أول عملية شراء من النموذج أعلاه</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>التاريخ</th>
                  <th>المورد</th>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي</th>
                  <th>ملاحظات</th>
                  {isAdmin && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row['معرف']}>
                    <td>{row['معرف']}</td>
                    <td>{row['التاريخ']}</td>
                    <td>{row['اسم المورد']}</td>
                    <td>{row['اسم الصنف']}</td>
                    <td className="number-cell">{formatNumber(row['الكمية'])}</td>
                    <td className="number-cell">{formatNumber(row['سعر الوحدة'])}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row['الإجمالي'])}</td>
                    <td>{row['ملاحظات']}</td>
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
        title="حذف عملية شراء"
        message="هل أنت متأكد من حذف هذه العملية؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AppLayout>
  );
}

export default function PurchasesPage() {
  return (
    <ToastProvider>
      <PurchasesContent />
    </ToastProvider>
  );
}
