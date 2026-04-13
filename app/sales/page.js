'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { formatNumber, getTodayDate } from '@/lib/utils';
import DetailModal from '@/components/DetailModal';
import SmartSelect from '@/components/SmartSelect';

function SalesContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;
  const isAdmin = role === 'admin';
  const canSeeCosts = role === 'admin' || role === 'manager';
  const isSeller = role === 'seller';

  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [bonusSettings, setBonusSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [whatsappShare, setWhatsappShare] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  const [form, setForm] = useState({
    date: getTodayDate(),
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    clientAddress: '',
    item: '',
    quantity: '',
    unitPrice: '',
    paymentType: 'كاش',
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

  // BUG-30: reactive price-floor check. Recomputes on every render from
  // form.item + form.unitPrice + products + role. Used to:
  //  (a) paint the sell-price input red
  //  (b) disable the submit button
  //  (c) show an inline error message below the input
  // Role-dependent message: admin/manager see the actual buy_price
  // (they have canSeeCosts anyway), sellers see vague language because
  // buy_price is a sensitive internal number per sales/page.js:229-232.
  const priceFloorError = (() => {
    if (!form.item || !form.unitPrice) return null;
    const p = products.find((pr) => pr.name === form.item);
    if (!p || !p.buy_price || p.buy_price <= 0) return null;
    const up = parseFloat(form.unitPrice);
    if (!up || up >= p.buy_price) return null;
    return canSeeCosts
      ? `سعر البيع (${up}€) أقل من سعر التكلفة (${p.buy_price}€). لا يمكن البيع بخسارة.`
      : 'سعر البيع المُدخَل غير مقبول. يرجى الالتزام بالسعر الموصى أو أعلى.';
  })();

  const fetchData = async () => {
    try {
      const fetches = [fetch('/api/sales'), fetch('/api/clients'), fetch('/api/products')];
      if (isSeller) fetches.push(fetch('/api/settings'));
      const results = await Promise.all(fetches);
      const salesData = await results[0].json();
      const clientsData = await results[1].json();
      const productsData = await results[2].json();
      setRows(Array.isArray(salesData) ? salesData.reverse() : []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
      if (isSeller && results[3]) setBonusSettings(await results[3].json());
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
    if (!form.date || !form.clientName || !form.item || !form.quantity || !form.unitPrice) {
      addToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }
    // Seller cannot sell below recommended price (existing rule — unchanged)
    if (isSeller) {
      const prod = products.find((p) => p.name === form.item);
      if (prod?.sell_price && parseFloat(form.unitPrice) < prod.sell_price) {
        addToast(`لا يمكن البيع بأقل من السعر الموصى (${prod.sell_price})`, 'error');
        return;
      }
    }
    // BUG-30: all-roles buy_price floor. Fires after the seller check so a
    // seller hitting the recommended-price error gets that (more specific)
    // message first. For admin/manager, this is the only gate; the reactive
    // priceFloorError above disables the submit button so this branch is a
    // belt-and-suspenders guard for direct-submit paths.
    if (priceFloorError) {
      addToast(priceFloorError, 'error');
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
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const result = await res.json();
        addToast('تم تسجيل عملية البيع وإنشاء توصيلة تلقائياً');

        // Ask if user wants to share via WhatsApp
        if (form.clientPhone) {
          const shareData = {
            phone: form.clientPhone.replace(/[^0-9+]/g, '').replace(/^00/, '').replace(/^\+/, ''),
            refCode: result.refCode || '',
            item: form.item,
            quantity: form.quantity,
            total,
            paymentMethod: form.paymentType,
            address: form.clientAddress,
          };
          setWhatsappShare(shareData);
        }

        setForm({ date: getTodayDate(), clientName: '', clientPhone: '', clientEmail: '', clientAddress: '', item: '', quantity: '', unitPrice: '', paymentType: 'كاش', notes: '' });
        fetchData();
      } else {
        const err = await res.json();
        addToast(err.error || 'خطأ في إضافة البيانات', 'error');
      }
    } catch (e) {
      addToast('خطأ في الاتصال: ' + (e.message || ''), 'error');
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
              <label htmlFor="sale-date">التاريخ *</label>
              <input id="sale-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>اسم العميل *</label>
              <SmartSelect
                value={form.clientName}
                onChange={(val, opt) => {
                  if (typeof opt === 'object' && opt.name) {
                    setForm((prev) => ({ ...prev, clientName: opt.name, clientPhone: opt.phone || prev.clientPhone, clientEmail: opt.email || prev.clientEmail, clientAddress: opt.address || prev.clientAddress }));
                  } else {
                    setForm((prev) => ({ ...prev, clientName: val }));
                  }
                }}
                options={clients.map((c) => ({ name: c.name, value: c.name, label: c.name, sub: c.phone || c.address || '', phone: c.phone, email: c.email, address: c.address }))}
                placeholder="اكتب اسم العميل..."
                allowNew
                newLabel="عميل جديد"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="sale-phone">هاتف العميل</label>
              <input id="sale-phone" type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="+31612345678 أو +966501234567" style={{ direction: 'ltr', textAlign: 'right' }} />
            </div>
            <div className="form-group">
              <label htmlFor="sale-email">إيميل العميل</label>
              <input id="sale-email" type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} placeholder="email@example.com" style={{ direction: 'ltr', textAlign: 'right' }} />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="sale-address">عنوان التوصيل</label>
              <input id="sale-address" type="text" value={form.clientAddress} onChange={(e) => setForm({ ...form, clientAddress: e.target.value })} placeholder="العنوان الكامل للتوصيل" />
            </div>
            <div className="form-group">
              <label htmlFor="sale-product">الصنف * (من المخزون)</label>
              <select
                id="sale-product"
                value={form.item}
                onChange={(e) => {
                  const p = products.find((pr) => pr.name === e.target.value);
                  setForm({ ...form, item: e.target.value, unitPrice: p?.sell_price || p?.buy_price || form.unitPrice });
                }}
                required
                style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontFamily: "'Cairo', sans-serif", fontSize: '0.9rem', background: 'white' }}
              >
                <option value="">اختر صنف من المخزون</option>
                {/* DONE: Bug 3 — never expose buy_price (cost) in seller's product dropdown */}
                {products.filter((p) => p.stock > 0).map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} (متاح: {p.stock}{canSeeCosts ? ` | تكلفة: ${p.buy_price}` : ''})
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
              <label htmlFor="sale-qty">الكمية * {form.item && products.find((p) => p.name === form.item) ? `(متاح: ${products.find((p) => p.name === form.item).stock})` : ''}</label>
              <input id="sale-qty" type="number" min="0" step="any" max={products.find((p) => p.name === form.item)?.stock || ''} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required />
            </div>
            <div className="form-group">
              <label htmlFor="sale-price">سعر البيع *</label>
              <input
                id="sale-price"
                type="number"
                min="0"
                step="any"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                placeholder="0"
                required
                style={priceFloorError ? { border: '2px solid #dc2626', background: '#fef2f2' } : undefined}
              />
              {/* BUG-30: inline error when unit_price < buy_price */}
              {priceFloorError && (
                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '4px' }}>
                  ⚠ {priceFloorError}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>الإجمالي</label>
              <input type="text" value={formatNumber(total)} readOnly />
            </div>
            {isSeller && form.item && form.unitPrice && (() => {
              const p = products.find((pr) => pr.name === form.item);
              const recommended = p?.sell_price || 0;
              const price = parseFloat(form.unitPrice) || 0;
              const qty = parseFloat(form.quantity) || 0;
              const fixedBonus = parseFloat(bonusSettings.seller_bonus_fixed) || 0;
              const pct = parseFloat(bonusSettings.seller_bonus_percentage) || 0;
              const extra = Math.max(0, price - recommended) * qty;
              const extraBonus = extra * pct / 100;
              const totalBonus = fixedBonus + extraBonus;
              return (
                <div className="form-group">
                  <label>البونص المتوقع (بعد التوصيل)</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '0.82rem', marginTop: '4px' }}>
                    <span style={{ background: '#dcfce7', padding: '4px 10px', borderRadius: '8px', color: '#16a34a' }}>
                      ثابت: {formatNumber(fixedBonus)}
                    </span>
                    {extraBonus > 0 && (
                      <span style={{ background: '#dbeafe', padding: '4px 10px', borderRadius: '8px', color: '#1e40af' }}>
                        إضافي ({pct}% من {formatNumber(extra)}): {formatNumber(extraBonus)}
                      </span>
                    )}
                    <span style={{ background: '#f0fdf4', padding: '6px 12px', borderRadius: '8px', color: '#15803d', fontWeight: 700, border: '1.5px solid #16a34a' }}>
                      المجموع: {formatNumber(totalBonus)}
                    </span>
                  </div>
                  {price < recommended && recommended > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#dc2626' }}>
                      السعر أقل من الموصى ({formatNumber(recommended)}) - لن يُقبل
                    </div>
                  )}
                </div>
              );
            })()}
            {form.item && canSeeCosts && (() => {
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
              <label>طريقة الدفع *</label>
              <div className="radio-group" style={{ marginTop: '6px' }}>
                <label className="radio-option">
                  <input id="pay-cash" type="radio" name="payType" value="كاش" checked={form.paymentType === 'كاش'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  كاش (عند التوصيل)
                </label>
                <label className="radio-option">
                  <input id="pay-bank" type="radio" name="payType" value="بنك" checked={form.paymentType === 'بنك'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  بنك (تحويل)
                </label>
                <label className="radio-option">
                  <input id="pay-credit" type="radio" name="payType" value="آجل" checked={form.paymentType === 'آجل'} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} />
                  آجل (دين)
                </label>
              </div>
              {form.paymentType === 'آجل' && (
                <div style={{ marginTop: '6px', padding: '8px 12px', background: '#fef3c7', borderRadius: '8px', fontSize: '0.8rem', color: '#92400e' }}>
                  سيُسجل كدين على العميل - يُدفع لاحقاً من صفحة تفاصيل العميل
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="sale-notes">ملاحظات</label>
              <input id="sale-notes" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات اختيارية" />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !!priceFloorError}
          >
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
                  {canSeeCosts && <th>التكلفة</th>}
                  {canSeeCosts && <th>الربح</th>}
                  <th>الحالة</th>
                  <th>الدفع</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="clickable-row" onClick={() => setSelectedRow(row)}>
                    <td style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.ref_code || `SL-${row.id}`}</td>
                    <td>{row.date}</td>
                    <td>{row.client_name}</td>
                    <td>{row.item}</td>
                    <td className="number-cell">{formatNumber(row.quantity)}</td>
                    <td className="number-cell">{formatNumber(row.unit_price)}</td>
                    <td className="number-cell" style={{ fontWeight: 600 }}>{formatNumber(row.total)}</td>
                    {canSeeCosts && <td className="number-cell" style={{ color: '#94a3b8' }}>{formatNumber(row.cost_total)}</td>}
                    {canSeeCosts && <td className="number-cell" style={{ color: (row.profit || 0) >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                      {formatNumber(row.profit)}
                    </td>}
                    <td>
                      <span className="status-badge" style={{
                        background: row.status === 'مؤكد' ? '#dcfce7' : row.status === 'ملغي' ? '#fee2e2' : '#fef3c7',
                        color: row.status === 'مؤكد' ? '#16a34a' : row.status === 'ملغي' ? '#dc2626' : '#d97706',
                      }}>
                        {row.status || 'محجوز'}
                      </span>
                    </td>
                    <td>
                      <span className="status-badge" style={{
                        background: row.payment_type === 'بنك' ? '#dbeafe' : row.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7',
                        color: row.payment_type === 'بنك' ? '#1e40af' : row.payment_type === 'آجل' ? '#d97706' : '#16a34a'
                      }}>
                        {row.payment_type || 'كاش'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#25d366', color: 'white', padding: '4px 8px' }}
                          onClick={() => {
                            const client = clients.find((c) => c.name === row.client_name);
                            const phone = (client?.phone || '').replace(/[^0-9+]/g, '').replace(/^00/, '').replace(/^\+/, '');
                            if (!phone) { addToast('لا يوجد رقم هاتف للعميل', 'error'); return; }
                            const msg = encodeURIComponent(
`*Vitesse Eco*
*الكود:* ${row.ref_code || row.id}
*المنتج:* ${row.item}
*الكمية:* ${row.quantity}
*المبلغ:* ${row.total}
*الحالة:* ${row.status || 'محجوز'}`
                            );
                            window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
                          }}
                          title="مشاركة عبر واتساب"
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.252-.149-2.737.813.813-2.737-.149-.252A8 8 0 1112 20z"/></svg>
                        </button>
                        {/* DONE: Bug 8 — sellers can delete their own reserved sales (admin can delete any) */}
                        {(isAdmin || (isSeller && row.created_by === session?.user?.username && row.status === 'محجوز')) && (
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(row.id)}>
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

      <DetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `بيع ${selectedRow.ref_code || selectedRow.id}` : ''}
        fields={selectedRow ? [
          { label: 'الكود', value: selectedRow.ref_code || `SL-${selectedRow.id}`, color: '#6366f1' },
          { label: 'التاريخ', value: selectedRow.date },
          { label: 'العميل', value: selectedRow.client_name },
          { type: 'divider' },
          { label: 'المنتج', value: selectedRow.item },
          { label: 'الكمية', value: selectedRow.quantity },
          { label: 'سعر الوحدة', type: 'money', value: selectedRow.unit_price },
          { label: 'الإجمالي', type: 'money', value: selectedRow.total },
          ...(canSeeCosts ? [
            { type: 'divider' },
            { label: 'التكلفة', type: 'money', value: selectedRow.cost_total, color: '#94a3b8' },
            { label: 'الربح', type: 'money', value: selectedRow.profit, color: (selectedRow.profit || 0) >= 0 ? '#16a34a' : '#dc2626' },
          ] : []),
          { type: 'divider' },
          { label: 'حالة الطلب', type: 'badge', value: selectedRow.status || 'محجوز', bg: selectedRow.status === 'مؤكد' ? '#dcfce7' : selectedRow.status === 'ملغي' ? '#fee2e2' : '#fef3c7', color: selectedRow.status === 'مؤكد' ? '#16a34a' : selectedRow.status === 'ملغي' ? '#dc2626' : '#d97706' },
          { label: 'طريقة الدفع', type: 'badge', value: selectedRow.payment_type || 'كاش', bg: selectedRow.payment_type === 'بنك' ? '#dbeafe' : selectedRow.payment_type === 'آجل' ? '#fef3c7' : '#dcfce7', color: selectedRow.payment_type === 'بنك' ? '#1e40af' : selectedRow.payment_type === 'آجل' ? '#d97706' : '#16a34a' },
          ...(selectedRow.created_by ? [{ label: 'بواسطة', value: selectedRow.created_by }] : []),
          ...(selectedRow.notes ? [{ label: 'ملاحظات', value: selectedRow.notes }] : []),
        ] : []}
      />

      {/* WhatsApp Share Modal */}
      {whatsappShare && (
        <div className="modal-overlay" onClick={() => setWhatsappShare(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#25d366', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.252-.149-2.737.813.813-2.737-.149-.252A8 8 0 1112 20z"/></svg>
            </div>
            <h3>تم تسجيل البيع بنجاح!</h3>
            <p>هل تريد مشاركة تفاصيل الطلب مع العميل عبر واتساب؟</p>
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px', margin: '16px 0', textAlign: 'right', fontSize: '0.85rem', lineHeight: 1.8 }}>
              <div><strong>الكود:</strong> {whatsappShare.refCode}</div>
              <div><strong>المنتج:</strong> {whatsappShare.item}</div>
              <div><strong>الكمية:</strong> {whatsappShare.quantity}</div>
              <div><strong>المبلغ:</strong> {formatNumber(whatsappShare.total)}</div>
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                style={{ background: '#25d366', color: 'white', flex: 1 }}
                onClick={() => {
                  const s = whatsappShare;
                  const msg = encodeURIComponent(
`*Vitesse Eco - تأكيد طلب*
━━━━━━━━━━━━━━━━━
*الكود:* ${s.refCode}
*المنتج:* ${s.item}
*الكمية:* ${s.quantity}
*المبلغ:* ${s.total}
*الدفع:* ${s.paymentMethod === 'نقدي' ? 'مدفوع' : 'آجل'}
━━━━━━━━━━━━━━━━━
*التوصيل إلى:* ${s.address || '-'}

شكراً لتعاملكم معنا!`
                  );
                  window.open(`https://wa.me/${s.phone}?text=${msg}`, '_blank');
                  setWhatsappShare(null);
                }}
              >
                إرسال عبر واتساب
              </button>
              <button className="btn btn-outline" onClick={() => setWhatsappShare(null)}>
                لا، شكراً
              </button>
            </div>
          </div>
        </div>
      )}

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
