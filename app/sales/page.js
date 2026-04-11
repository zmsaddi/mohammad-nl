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
    clientPhone: '',
    clientEmail: '',
    clientAddress: '',
    item: '',
    quantity: '',
    unitPrice: '',
    paymentMethod: 'نقدي',
    paymentType: 'نقدي',
    paidAmount: '',
    notes: '',
  });

  // Smart auto-fill: when client name matches, fill all their info
  const handleClientChange = (name) => {
    const client = clients.find((c) => c.name === name);
    setForm((prev) => ({
      ...prev,
      clientName: name,
      clientPhone: client ? client.phone || prev.clientPhone : prev.clientPhone,
      clientEmail: client ? client.email || prev.clientEmail : prev.clientEmail,
      clientAddress: client ? client.address || prev.clientAddress : prev.clientAddress,
    }));
  };

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
      const clientExists = clients.some((c) => c.name === form.clientName);
      if (!clientExists) {
        await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.clientName }),
        });
      }

      // Auto-create product if new
      const productExists = products.some((p) => p.name === form.item);
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
        addToast('تم تسجيل عملية البيع وإنشاء توصيلة تلقائياً');
        setForm({ date: getTodayDate(), clientName: '', clientPhone: '', clientEmail: '', clientAddress: '', item: '', quantity: '', unitPrice: '', paymentMethod: 'نقدي', paymentType: 'نقدي', paidAmount: '', notes: '' });
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
        <h2>المبيعات</h2>
        <p>بيع الدراجات والإكسسوارات وقطع الغيار</p>
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
                onChange={(e) => handleClientChange(e.target.value)}
                placeholder="اكتب اسم العميل..."
                required
                autoComplete="off"
              />
              <datalist id="clients-list">
                {clients.map((c) => <option key={c.id} value={c.name} label={`${c.phone || ''} - ${c.address || ''}`} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label>هاتف العميل</label>
              <input type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="05xxxxxxxx" style={{ direction: 'ltr', textAlign: 'right' }} />
            </div>
            <div className="form-group">
              <label>إيميل العميل</label>
              <input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} placeholder="email@example.com" style={{ direction: 'ltr', textAlign: 'right' }} />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label>عنوان التوصيل</label>
              <input type="text" value={form.clientAddress} onChange={(e) => setForm({ ...form, clientAddress: e.target.value })} placeholder="العنوان الكامل للتوصيل" />
            </div>
            <div className="form-group">
              <label>الصنف * (من المخزون)</label>
              <select
                value={form.item}
                onChange={(e) => {
                  const p = products.find((pr) => pr.name === e.target.value);
                  setForm({ ...form, item: e.target.value, unitPrice: p?.sell_price || p?.buy_price || form.unitPrice });
                }}
                required
                style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.9rem', background: 'white' }}
              >
                <option value="">اختر صنف من المخزون</option>
                {products.filter((p) => p.stock > 0).map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} (متاح: {p.stock} | تكلفة: {p.buy_price})
                  </option>
                ))}
                {products.filter((p) => !p.stock || p.stock <= 0).length > 0 && (
                  <optgroup label="-- نفذ المخزون --">
                    {products.filter((p) => !p.stock || p.stock <= 0).map((p) => (
                      <option key={p.id} value={p.name} disabled style={{ color: '#999' }}>
                        {p.name} (نفذ)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="form-group">
              <label>الكمية * {form.item && products.find((p) => p.name === form.item) ? `(متاح: ${products.find((p) => p.name === form.item).stock})` : ''}</label>
              <input type="number" min="0" step="any" max={products.find((p) => p.name === form.item)?.stock || ''} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label>سعر البيع *</label>
              <input type="number" min="0" step="any" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label>الإجمالي</label>
              <input type="text" value={formatNumber(total)} readOnly />
            </div>
            {form.item && (() => {
              const p = products.find((pr) => pr.name === form.item);
              const costPrice = p?.buy_price || 0;
              const qty = parseFloat(form.quantity) || 0;
              const costTotal = qty * costPrice;
              const saleProfit = total - costTotal;
              return (
                <div className="form-group">
                  <label>الربح المتوقع</label>
                  <div style={{ display: 'flex', gap: '8px', fontSize: '0.85rem', marginTop: '4px' }}>
                    <span style={{ background: '#fee2e2', padding: '4px 10px', borderRadius: '8px', color: '#dc2626' }}>
                      التكلفة: {formatNumber(costTotal)}
                    </span>
                    <span style={{ background: saleProfit >= 0 ? '#dcfce7' : '#fee2e2', padding: '4px 10px', borderRadius: '8px', color: saleProfit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                      الربح: {formatNumber(saleProfit)}
                    </span>
                  </div>
                </div>
              );
            })()}
            <div className="form-group">
              <label>حالة الدفع *</label>
              <div className="radio-group" style={{ marginTop: '6px' }}>
                <label className="radio-option">
                  <input type="radio" name="payment" value="نقدي" checked={form.paymentMethod === 'نقدي'} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value, paidAmount: '' })} />
                  مدفوع
                </label>
                <label className="radio-option">
                  <input type="radio" name="payment" value="آجل" checked={form.paymentMethod === 'آجل'} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} />
                  آجل (دين)
                </label>
              </div>
            </div>
            <div className="form-group">
              <label>وسيلة الدفع</label>
              <div className="radio-group" style={{ marginTop: '6px' }}>
                <label className="radio-option">
                  <input type="radio" name="payType" value="نقدي" checked={form.paymentType === 'نقدي'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  نقدي (كاش)
                </label>
                <label className="radio-option">
                  <input type="radio" name="payType" value="بنك" checked={form.paymentType === 'بنك'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  بنك (تحويل)
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
                  <th>الكود</th>
                  <th>التاريخ</th>
                  <th>العميل</th>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي</th>
                  <th>التكلفة</th>
                  <th>الربح</th>
                  <th>الحالة</th>
                  <th>الدفع</th>
                  {isAdmin && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.ref_code || `SL-${row.id}`}</td>
                    <td>{row.date}</td>
                    <td>{row.client_name}</td>
                    <td>{row.item}</td>
                    <td className="number-cell">{formatNumber(row.quantity)}</td>
                    <td className="number-cell">{formatNumber(row.unit_price)}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.total)}</td>
                    <td className="number-cell" style={{ color: '#94a3b8' }}>{formatNumber(row.cost_total)}</td>
                    <td className="number-cell" style={{ color: (row.profit || 0) >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                      {formatNumber(row.profit)}
                    </td>
                    <td>
                      <span className="status-badge" style={{
                        background: row.status === 'مؤكد' ? '#dcfce7' : row.status === 'ملغي' ? '#fee2e2' : '#fef3c7',
                        color: row.status === 'مؤكد' ? '#16a34a' : row.status === 'ملغي' ? '#dc2626' : '#d97706',
                      }}>
                        {row.status || 'محجوز'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${row.payment_method === 'نقدي' ? 'status-cash' : 'status-credit'}`}>
                        {row.payment_method}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>
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
