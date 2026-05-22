'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import { ToastProvider, useToast } from '@/components/Toast';
import { formatNumber } from '@/lib/utils';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import PageSkeleton from '@/components/PageSkeleton';
import ConfirmModal from '@/components/ConfirmModal';
import MoneyInput from '@/components/MoneyInput';

const ROLE_LABEL = { admin: 'مدير عام', manager: 'مشرف', driver: 'سائق', seller: 'بائع' };

function TreasuryContent() {
  const { data: session } = useSession();
  const addToast = useToast();
  const role = session?.user?.role;
  const username = session?.user?.username;
  const canFund = role === 'admin' || role === 'manager';

  const [boxes, setBoxes] = useState([]);
  const [pending, setPending] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [generalBoxId, setGeneralBoxId] = useState(null);
  const [myBoxId, setMyBoxId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [handAmount, setHandAmount] = useState('');
  const [fundForm, setFundForm] = useState({ toBoxId: '', amount: '' });
  const [reqForm, setReqForm] = useState({ fromBoxId: '', amount: '' });
  const [capForm, setCapForm] = useState({ kind: 'injection', amount: '', method: 'كاش' });
  const [capitalOps, setCapitalOps] = useState([]);
  const [openingInputs, setOpeningInputs] = useState({});
  const [recon, setRecon] = useState(null);
  // Guards every money action below against a double-tap while the POST is
  // in flight (each one moves real money). Disables the action buttons.
  const [busy, setBusy] = useState(false);
  // Branded confirm dialog (replaces window.confirm for the two money-sensitive
  // admin actions: setting an opening balance + toggling the treasury system).
  const [confirmDialog, setConfirmDialog] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/treasury/boxes', { cache: 'no-store' });
      const data = await res.json();
      setBoxes(Array.isArray(data?.boxes) ? data.boxes : []);
      setEnabled(data?.enabled !== false);
      setGeneralBoxId(data?.generalBoxId ?? null);
      setMyBoxId(data?.myBoxId ?? null);
      if (data?.enabled !== false) {
        const hres = await fetch('/api/treasury/handovers', { cache: 'no-store' });
        if (hres.ok) setPending(await hres.json());
        if (role === 'admin') {
          const cres = await fetch('/api/treasury/capital', { cache: 'no-store' });
          if (cres.ok) setCapitalOps(await cres.json());
          const rres = await fetch('/api/treasury/reconciliation', { cache: 'no-store' });
          if (rres.ok) setRecon(await rres.json());
        }
      }
    } catch { addToast('خطأ في جلب البيانات', 'error'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);
  useAutoRefresh(fetchData);

  const boxName = (b) => b.type === 'main' ? 'الصندوق العام' : (b.owner_name || b.owner_username || '—');
  const total = boxes.reduce((s, b) => s + (parseFloat(b.balance) || 0), 0);
  // Funding recipients the caller may fund: manager → drivers; admin → any custody box.
  const fundTargets = boxes.filter((b) => b.type === 'custody' && (role === 'admin' || b.owner_role === 'driver') && b.owner_username !== username);

  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  };

  const handleHandover = async () => {
    if (!myBoxId || !generalBoxId) { addToast('الصناديق غير مهيّأة', 'error'); return; }
    if (!(parseFloat(handAmount) > 0)) { addToast('أدخل مبلغاً صحيحاً', 'error'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const { ok, d } = await post('/api/treasury/handovers', { kind: 'handover', fromBoxId: myBoxId, toBoxId: generalBoxId, amount: handAmount });
      if (ok) { addToast('تم إنشاء طلب تسليم — بانتظار تأكيد الصندوق العام'); setHandAmount(''); fetchData(); }
      else addToast(d.error || 'خطأ', 'error');
    } finally { setBusy(false); }
  };

  const handleFund = async () => {
    if (!fundForm.toBoxId) { addToast('اختر المستلم', 'error'); return; }
    if (!(parseFloat(fundForm.amount) > 0)) { addToast('أدخل مبلغاً صحيحاً', 'error'); return; }
    const fromBoxId = role === 'admin' ? generalBoxId : myBoxId; // admin funds from treasury, manager from own
    if (!fromBoxId) { addToast('صندوق المصدر غير مهيّأ', 'error'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const { ok, d } = await post('/api/treasury/handovers', { kind: 'funding', fromBoxId, toBoxId: Number(fundForm.toBoxId), amount: fundForm.amount });
      if (ok) { addToast('تم إنشاء طلب تمويل — بانتظار تأكيد المستلم'); setFundForm({ toBoxId: '', amount: '' }); fetchData(); }
      else addToast(d.error || 'خطأ', 'error');
    } finally { setBusy(false); }
  };

  // Request a person to settle their custody (مطالبة بتسليم العهدة). The money
  // moves FROM their box TO the requester's collection point (admin → general
  // box; manager → own box) — but ONLY after the holder confirms. Initiator is
  // the admin/manager, so the holder (not the initiator) is the one who confirms.
  // Prefill the amount with the holder's full balance (editable for partials).
  const pickRequestPerson = (boxId) => {
    const b = boxes.find((x) => String(x.id) === String(boxId));
    const bal = b ? (parseFloat(b.balance) || 0) : 0;
    setReqForm({ fromBoxId: boxId, amount: boxId && bal > 0 ? String(bal) : '' });
  };

  const handleRequestSettlement = async () => {
    if (!reqForm.fromBoxId) { addToast('اختر الشخص', 'error'); return; }
    if (!(parseFloat(reqForm.amount) > 0)) { addToast('أدخل مبلغاً صحيحاً', 'error'); return; }
    const toBoxId = role === 'admin' ? generalBoxId : myBoxId; // hierarchy: admin → general, manager → own
    if (!toBoxId) { addToast('صندوق الوجهة غير مهيّأ', 'error'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const { ok, d } = await post('/api/treasury/handovers', { kind: 'handover', fromBoxId: Number(reqForm.fromBoxId), toBoxId, amount: reqForm.amount });
      if (ok) { addToast('تم إرسال طلب التسليم — بانتظار تأكيد حامل العهدة'); setReqForm({ fromBoxId: '', amount: '' }); fetchData(); }
      else addToast(d.error || 'خطأ', 'error');
    } finally { setBusy(false); }
  };

  const handleConfirm = async (id) => {
    const { ok, d } = await post(`/api/treasury/handovers/${id}/confirm`);
    if (ok) { addToast('تم تأكيد التحويل ✓'); fetchData(); } else addToast(d.error || 'خطأ', 'error');
  };
  const handleReject = async (id) => {
    const { ok, d } = await post(`/api/treasury/handovers/${id}/reject`);
    if (ok) { addToast('تم رفض الطلب'); fetchData(); } else addToast(d.error || 'خطأ', 'error');
  };

  const handleInitCapital = async () => {
    if (!(parseFloat(capForm.amount) > 0)) { addToast('أدخل مبلغاً صحيحاً', 'error'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const { ok, d } = await post('/api/treasury/capital', capForm);
      if (ok) {
        addToast(d.status === 'approved' ? 'تمّ تنفيذ العملية' : 'تمّ إنشاء العملية — بانتظار موافقة بقية المدراء');
        setCapForm({ kind: 'injection', amount: '', method: 'كاش' });
        fetchData();
      } else addToast(d.error || 'خطأ', 'error');
    } finally { setBusy(false); }
  };
  const handleApproveCapital = async (id) => {
    const { ok, d } = await post(`/api/treasury/capital/${id}/approve`);
    if (ok) { addToast(d.status === 'approved' ? 'تمّ التنفيذ ✓' : 'تمّت موافقتك — بانتظار البقية'); fetchData(); } else addToast(d.error || 'خطأ', 'error');
  };
  const handleRejectCapital = async (id) => {
    const { ok, d } = await post(`/api/treasury/capital/${id}/reject`);
    if (ok) { addToast('تم رفض العملية'); fetchData(); } else addToast(d.error || 'خطأ', 'error');
  };

  // Opening balance (admin go-live): set a box's starting cash by physical count.
  // Deliberate, with an explicit confirm; re-entry replaces the prior opening.
  const handleSetOpening = (box) => {
    const raw = openingInputs[box.id];
    if (raw === undefined || raw === '') { addToast('أدخل المبلغ', 'error'); return; }
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) { addToast('أدخل رصيداً صحيحاً (≥ 0)', 'error'); return; }
    const hasOpening = box.opening != null;
    const msg = `تعيين الرصيد الافتتاحي (عدّ فعلي) لصندوق «${boxName(box)}» = ${formatNumber(amount)} €؟` +
      (hasOpening ? `\n\nيوجد رصيد افتتاحي سابق (${formatNumber(parseFloat(box.opening) || 0)} €) — سيُستبدل.` : '') +
      `\n\nيُسجَّل كنقطة بداية لتتبّع النقد. متابعة؟`;
    setConfirmDialog({
      title: 'تأكيد الرصيد الافتتاحي',
      message: msg,
      confirmText: 'تأكيد',
      confirmClass: 'btn-primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        const { ok, d } = await post('/api/treasury/opening', { boxId: box.id, amount });
        if (ok) { addToast('تم تعيين الرصيد الافتتاحي ✓'); setOpeningInputs((s) => ({ ...s, [box.id]: '' })); fetchData(); }
        else addToast(d.error || 'خطأ', 'error');
      },
    });
  };

  // Master switch (admin). Toggling NEVER deletes data — it only starts/stops
  // recording money movements; balances and all records are preserved.
  const toggleTreasury = () => {
    const turningOn = !enabled;
    const msg = turningOn
      ? 'تفعيل نظام الصناديق؟ سيبدأ تسجيل حركة الأموال من الآن. لا تُفقد أي بيانات حالية. تذكّر إدخال الأرصدة الافتتاحية (عدّ فعلي) بعد التفعيل.'
      : 'إيقاف نظام الصناديق؟ يتوقّف تسجيل الحركات الجديدة، وتبقى كل الأرصدة والبيانات كما هي.';
    setConfirmDialog({
      title: turningOn ? 'تفعيل نظام الصناديق' : 'إيقاف نظام الصناديق',
      message: msg,
      confirmText: turningOn ? 'تفعيل' : 'إيقاف',
      confirmClass: turningOn ? 'btn-success' : 'btn-danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ treasury_enabled: turningOn ? 'true' : 'false' }), cache: 'no-store' });
          if (res.ok) { addToast(turningOn ? 'تم تفعيل نظام الصناديق' : 'تم إيقاف نظام الصناديق'); fetchData(); }
          else { const d = await res.json().catch(() => ({})); addToast(d.error || 'خطأ', 'error'); }
        } catch { addToast('خطأ في الاتصال', 'error'); }
      },
    });
  };

  const partyLabel = (type, name, owner) => type === 'main' ? 'الصندوق العام' : (name || owner || '—');

  return (
    <AppLayout>
      <div className="page-header">
        <h2>إدارة المال</h2>
        <p>{role === 'admin' ? 'أرصدة كل الصناديق والتحويلات' : role === 'manager' ? 'صندوقك وصناديق السائقين' : 'صندوق عهدتك'}</p>
      </div>

      {!enabled && (
        <div className="card" style={{ marginBottom: 16, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: '0.9rem' }}>
          ⏳ نظام الصناديق قيد التهيئة — العرض للاطّلاع فقط، والإجراءات تظهر عند التفعيل.
        </div>
      )}

      {/* Master switch — admin only. Toggling never deletes data. */}
      {role === 'admin' && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>نظام الصناديق:</strong>{' '}
            {enabled
              ? <span style={{ color: '#16a34a', fontWeight: 700 }}>مُفعَّل</span>
              : <span style={{ color: '#9a3412', fontWeight: 700 }}>متوقّف</span>}
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 4 }}>
              التفعيل أو الإيقاف لا يحذف أي بيانات — الأرصدة والسجلّات تبقى كما هي.
            </div>
          </div>
          <button
            className="btn"
            style={{ background: enabled ? '#fee2e2' : '#16a34a', color: enabled ? '#dc2626' : '#fff', border: 'none', whiteSpace: 'nowrap' }}
            onClick={toggleTreasury}
          >
            {enabled ? 'إيقاف النظام' : 'تفعيل النظام'}
          </button>
        </div>
      )}

      <div className="summary-cards" style={{ marginBottom: 24 }}>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dcfce7' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#16a34a" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>{role === 'admin' ? 'إجمالي كاش المشروع' : 'إجمالي المعروض'}</h3>
            <div className="value" style={{ color: '#16a34a' }}>{formatNumber(total)} €</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#dbeafe' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#1e40af" width="24" height="24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4" /></svg>
          </div>
          <div className="summary-card-content">
            <h3>طلبات معلّقة</h3>
            <div className="value" style={{ color: '#1e40af' }}>{pending.length}</div>
          </div>
        </div>
      </div>

      {/* Boxes */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>الصناديق</h3>
        {loading ? (
          <PageSkeleton rows={4} />
        ) : boxes.length === 0 ? (
          <div className="empty-state"><h3>لا توجد صناديق</h3><p>شغّل تهيئة النظام (/api/init) لإنشاء الصناديق.</p></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>الصندوق</th><th>النوع</th><th>الرصيد</th></tr></thead>
              <tbody>
                {boxes.map((b) => {
                  const bal = parseFloat(b.balance) || 0;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>
                        {boxName(b)}
                        {b.type !== 'main' && b.owner_role && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.8rem' }}> ({ROLE_LABEL[b.owner_role] || b.owner_role})</span>}
                      </td>
                      <td>{b.type === 'main' ? 'عام' : 'عهدة'}</td>
                      <td className="number-cell" style={{ fontWeight: 700, color: bal < 0 ? '#dc2626' : '#16a34a' }}>{formatNumber(bal)} €</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Actions — only when the treasury is live */}
      {enabled && (
        <>
          {/* Opening balances (admin go-live): physical cash count per box */}
          {role === 'admin' && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>الأرصدة الافتتاحية (عدّ فعلي)</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
                أدخل النقد الفعلي الموجود في كل صندوق الآن كنقطة بداية. يُسجَّل كرصيد افتتاحي، ويمكن تصحيحه بإعادة الإدخال (يستبدل السابق).
              </p>
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>الصندوق</th><th>الرصيد الحالي</th><th>الافتتاحي المُسجّل</th><th>تعيين رصيد افتتاحي</th></tr></thead>
                  <tbody>
                    {boxes.map((b) => (
                      <tr key={b.id}>
                        <td style={{ fontWeight: 600 }}>
                          {boxName(b)}
                          {b.type !== 'main' && b.owner_role && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.8rem' }}> ({ROLE_LABEL[b.owner_role] || b.owner_role})</span>}
                        </td>
                        <td className="number-cell">{formatNumber(parseFloat(b.balance) || 0)} €</td>
                        <td className="number-cell" style={{ color: b.opening != null ? '#16a34a' : '#94a3b8' }}>
                          {b.opening != null ? `${formatNumber(parseFloat(b.opening) || 0)} €` : '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <MoneyInput
                              min="0" step="any"
                              value={openingInputs[b.id] ?? ''}
                              onChange={(e) => setOpeningInputs((s) => ({ ...s, [b.id]: e.target.value }))}
                              placeholder="0.00"
                              style={{ maxWidth: 120 }}
                            />
                            <button className="btn btn-sm btn-primary" onClick={() => handleSetOpening(b)}>تعيين</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Reconciliation (admin): boxes vs ledgers — surfaces any untracked money */}
          {role === 'admin' && recon?.available && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>المطابقة</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
                مقارنة أرصدة الصناديق بالدفاتر للتأكّد من عدم وجود حركة مال غير مسجّلة.
              </p>
              {(() => {
                const okIntegrity = Math.abs(recon.integrityDiff) < 0.005;
                const cov = recon.coverage;
                const okCoverage = cov && Math.abs(cov.diff) < 0.005;
                const pill = (ok, label) => (
                  <span style={{ background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#16a34a' : '#dc2626', padding: '2px 10px', borderRadius: 999, fontWeight: 700, fontSize: '0.8rem' }}>
                    {ok ? `✓ ${label}` : `⚠ ${label}`}
                  </span>
                );
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.88rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span>تطابق الصناديق مع الحركات</span>
                      {pill(okIntegrity, okIntegrity ? 'سليم' : `فرق ${formatNumber(recon.integrityDiff)} €`)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      إجمالي الصناديق <strong>{formatNumber(recon.boxesTotal)} €</strong> = افتتاحي {formatNumber(recon.openingTotal)} + حركة {formatNumber(recon.movementsActivity)}
                    </div>
                    {cov ? (
                      <>
                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <span>تغطية الدفاتر (منذ {recon.cutoff})</span>
                          {pill(okCoverage, okCoverage ? 'مطابق' : `فرق ${formatNumber(cov.diff)} €`)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          صافي الدفاتر <strong>{formatNumber(cov.coreNet)} €</strong> · صافي الحركات <strong>{formatNumber(cov.movementsActivity)} €</strong>
                          <div style={{ marginTop: 4 }}>
                            تحصيلات {formatNumber(cov.collections)} − مورّدون {formatNumber(cov.supplierPaid)} − مصروفات {formatNumber(cov.expenses)} − عمولات {formatNumber(cov.payouts)} − أرباح {formatNumber(cov.distributions)} + رأس مال {formatNumber(cov.capitalNet)}
                          </div>
                        </div>
                        {!okCoverage && (
                          <div style={{ fontSize: '0.78rem', color: '#9a3412' }}>
                            قد ينتج الفرق عن إدخال عملية بتاريخ سابق لتاريخ البداية — راجع الحركات قبل الاعتماد.
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>أدخل الأرصدة الافتتاحية لتفعيل فحص تغطية الدفاتر.</div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Pending requests */}
          <div className="card" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>طلبات بانتظار التأكيد ({pending.length})</h3>
            {pending.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>لا توجد طلبات معلّقة.</p>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>المبلغ</th><th>المُبادِر</th><th>إجراء</th></tr></thead>
                  <tbody>
                    {pending.map((h) => {
                      const mine = h.initiated_by === username;
                      return (
                        <tr key={h.id}>
                          <td>{h.kind === 'funding' ? 'تمويل' : 'تسليم'}</td>
                          <td>{partyLabel(h.from_type, h.from_name, h.from_owner)}</td>
                          <td>{partyLabel(h.to_type, h.to_name, h.to_owner)}</td>
                          <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(h.amount)} €</td>
                          <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{h.initiated_by}{mine ? ' (أنت)' : ''}</td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {!mine && (
                              <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => handleConfirm(h.id)}>✓ تأكيد</button>
                            )}
                            <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => handleReject(h.id)}>{mine ? 'إلغاء الطلب' : 'رفض'}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Hand over to the general box */}
          {myBoxId && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>تسليم عهدة إلى الصندوق العام</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>سلّم مبلغاً من صندوقك إلى الصندوق العام — يتحرّك المال بعد تأكيد مدير عام.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ maxWidth: 180, margin: 0 }}>
                  <label>المبلغ (€)</label>
                  <MoneyInput min="0" step="any" value={handAmount} onChange={(e) => setHandAmount(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={handleHandover} disabled={busy}>{busy ? 'جارٍ…' : 'إنشاء طلب تسليم'}</button>
              </div>
            </div>
          )}

          {/* Funding (admin/manager) */}
          {canFund && fundTargets.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>تمويل صندوق</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
                {role === 'admin' ? 'تمويل من الصندوق العام إلى صندوق شخص.' : 'تمويل سائق من صندوقك.'} يتحرّك المال بعد تأكيد المستلم.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ maxWidth: 240, margin: 0 }}>
                  <label>المستلم</label>
                  <select value={fundForm.toBoxId} onChange={(e) => setFundForm({ ...fundForm, toBoxId: e.target.value })}>
                    <option value="">-- اختر --</option>
                    {fundTargets.map((b) => (
                      <option key={b.id} value={b.id}>{boxName(b)} ({ROLE_LABEL[b.owner_role] || b.owner_role})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ maxWidth: 180, margin: 0 }}>
                  <label>المبلغ (€)</label>
                  <MoneyInput min="0" step="any" value={fundForm.amount} onChange={(e) => setFundForm({ ...fundForm, amount: e.target.value })} />
                </div>
                <button className="btn btn-primary" onClick={handleFund} disabled={busy}>{busy ? 'جارٍ…' : 'إنشاء طلب تمويل'}</button>
              </div>
            </div>
          )}

          {/* Request settlement (admin/manager) — ask a holder to hand over their custody */}
          {canFund && fundTargets.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>طلب تسليم عهدة</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
                اطلب من شخص تسليم عهدته{role === 'admin' ? ' إلى الصندوق العام' : ' إلى صندوقك'}. لا يتحرّك المال حتى يؤكّد حامل العهدة التسليم فعلياً.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ maxWidth: 280, margin: 0 }}>
                  <label>الشخص</label>
                  <select value={reqForm.fromBoxId} onChange={(e) => pickRequestPerson(e.target.value)}>
                    <option value="">-- اختر --</option>
                    {fundTargets.map((b) => (
                      <option key={b.id} value={b.id}>{boxName(b)} ({ROLE_LABEL[b.owner_role] || b.owner_role}) — رصيد: {formatNumber(parseFloat(b.balance) || 0)} €</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ maxWidth: 180, margin: 0 }}>
                  <label>المبلغ المطلوب (€)</label>
                  <MoneyInput min="0" step="any" value={reqForm.amount} onChange={(e) => setReqForm({ ...reqForm, amount: e.target.value })} />
                </div>
                <button className="btn btn-primary" onClick={handleRequestSettlement} disabled={busy}>{busy ? 'جارٍ…' : 'إرسال الطلب'}</button>
              </div>
            </div>
          )}

          {/* Capital in/out (admin only) — requires all admins to approve */}
          {role === 'admin' && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>رأس المال (إدخال / سحب)</h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12 }}>
                إدخال رأسمال خارجي أو سحبه من الصندوق العام. يتطلّب موافقة كل المدراء العامين (إن وُجد أكثر من مدير).
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
                <div className="form-group" style={{ maxWidth: 170, margin: 0 }}>
                  <label>النوع</label>
                  <select value={capForm.kind} onChange={(e) => setCapForm({ ...capForm, kind: e.target.value })}>
                    <option value="injection">إدخال رأسمال</option>
                    <option value="withdrawal">سحب رأسمال</option>
                  </select>
                </div>
                <div className="form-group" style={{ maxWidth: 150, margin: 0 }}>
                  <label>المبلغ (€)</label>
                  <MoneyInput min="0" step="any" value={capForm.amount} onChange={(e) => setCapForm({ ...capForm, amount: e.target.value })} />
                </div>
                <div className="form-group" style={{ maxWidth: 120, margin: 0 }}>
                  <label>الطريقة</label>
                  <select value={capForm.method} onChange={(e) => setCapForm({ ...capForm, method: e.target.value })}>
                    <option value="كاش">كاش</option>
                    <option value="بنك">بنك</option>
                  </select>
                </div>
                <button className="btn btn-primary" onClick={handleInitCapital} disabled={busy}>{busy ? 'جارٍ…' : 'إنشاء'}</button>
              </div>
              {capitalOps.length > 0 && (
                <div className="table-container">
                  <table className="data-table">
                    <thead><tr><th>النوع</th><th>المبلغ</th><th>الموافقات</th><th>المُبادِر</th><th>إجراء</th></tr></thead>
                    <tbody>
                      {capitalOps.map((o) => (
                        <tr key={o.id}>
                          <td>{o.kind === 'injection' ? 'إدخال' : 'سحب'}</td>
                          <td className="number-cell" style={{ fontWeight: 700 }}>{formatNumber(o.amount)} €</td>
                          <td>{o.approvals} / {o.admin_count}</td>
                          <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{o.initiated_by}</td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => handleApproveCapital(o.id)}>✓ موافقة</button>
                            <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => handleRejectCapital(o.id)}>رفض</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={!!confirmDialog}
        title={confirmDialog?.title}
        confirmText={confirmDialog?.confirmText}
        confirmClass={confirmDialog?.confirmClass}
        onConfirm={confirmDialog?.onConfirm}
        onCancel={() => setConfirmDialog(null)}
      >
        <p style={{ whiteSpace: 'pre-line', color: '#64748b', fontSize: '0.9rem', marginBottom: 24 }}>
          {confirmDialog?.message}
        </p>
      </ConfirmModal>
    </AppLayout>
  );
}

export default function TreasuryPage() {
  return <ToastProvider><TreasuryContent /></ToastProvider>;
}
