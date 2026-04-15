// DONE: Step 2
// Standalone HTML invoice generator for VITESSE ECO SAS.
// Pure function — takes invoice row + settings dict, returns a complete HTML
// document. Caller is responsible for delivering it (the PDF route serves it
// inline so the browser can render and the user can Ctrl+P to PDF).

/**
 * @param {Object} invoice  invoices table row, enriched by the PDF route
 *   with `payment_status` (from sales.payment_status) for three-state rendering
 * @param {Object} settings flat key→value map from getSettings()
 * @param {Array}  payments optional list of collection payment rows for this
 *   sale — renders a payments history block when non-empty. Each row:
 *   { date, amount, payment_method, tva_amount }
 * @returns {string} full HTML document
 */
export function generateInvoiceHTML(invoice, settings, payments = []) {
  // Extract settings with safe fallbacks (DB-seeded defaults match these anyway)
  const shopName    = settings.shop_name    || 'VITESSE ECO SAS';
  const shopAddress = settings.shop_address || '32 Rue du Faubourg du Pont Neuf';
  const shopCity    = settings.shop_city    || '86000 Poitiers, France';
  const shopEmail   = settings.shop_email   || 'contact@vitesse-eco.fr';
  const shopWebsite = settings.shop_website || 'www.vitesse-eco.fr';
  const shopSiret   = settings.shop_siret   || '100 732 247 00018';
  const shopSiren   = settings.shop_siren   || '100 732 247';
  const shopVAT     = settings.shop_vat_number || '';
  const shopIBAN    = settings.shop_iban    || '';
  const shopBIC     = settings.shop_bic     || '';
  const vatRate     = parseFloat(settings.vat_rate || '20');
  const currency    = settings.invoice_currency || 'EUR';

  // Amounts: stored prices are TTC (tax inclusive), so back-calculate HT and the VAT line
  const totalTTC  = parseFloat(invoice.total) || 0;
  const vatAmount = totalTTC * vatRate / (100 + vatRate);
  const totalHT   = totalTTC - vatAmount;

  // French currency formatter
  const fmt = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(n);

  // FEAT-04: three-state rendering. The invoice row is enriched by the PDF
  // route with `payment_status` + `down_payment_expected` from the joined
  // sales row so the generator can render EN ATTENTE / PARTIELLE / PAYÉE.
  // Cancelled invoices still override everything with ANNULÉE.
  const isVoided = invoice.status === 'ملغي';
  const paidTotal = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const remaining = Math.max(0, totalTTC - paidTotal);
  const dpe = parseFloat(invoice.down_payment_expected) || 0;

  // Priority: voided > payment_status from sales row > derived from paidTotal
  let stateKey;
  if (isVoided) {
    stateKey = 'cancelled';
  } else if (invoice.payment_status === 'paid' || remaining < 0.005 && paidTotal > 0.005) {
    stateKey = 'paid';
  } else if (invoice.payment_status === 'partial' || paidTotal > 0.005) {
    stateKey = 'partial';
  } else {
    stateKey = 'pending';
  }

  const STATE_LABELS = {
    cancelled: 'ANNULÉE',
    pending:   'EN ATTENTE',
    partial:   'PARTIELLE',
    paid:      'PAYÉE',
  };
  const STATE_COLORS = {
    cancelled: '#dc2626',
    pending:   '#f59e0b',
    partial:   '#ea580c',
    paid:      '#16a34a',
  };
  const statusLabel = STATE_LABELS[stateKey];
  const statusColor = STATE_COLORS[stateKey];

  // Payment label translation
  const payMap = {
    'كاش': 'Espèces / À la livraison',
    'بنك': 'Virement bancaire',
    'آجل': 'Crédit (paiement différé)',
  };
  const payLabel = payMap[invoice.payment_type] || invoice.payment_type || '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture ${invoice.ref_code}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    color: #1a1a1a;
    background: white;
    padding: 40px;
    max-width: 794px;
    margin: 0 auto;
  }
  .top-bar { height:5px; background:#1a3a2a; margin-bottom:32px; }
  .header { display:flex; justify-content:space-between; margin-bottom:32px; }
  .logo-area { display:flex; flex-direction:column; gap:4px; }
  .logo-name { font-size:24px; font-weight:800; color:#1a3a2a; letter-spacing:0.05em; }
  .logo-sub  { font-size:10px; color:#6b7280; letter-spacing:0.15em; text-transform:uppercase; }
  .invoice-meta { text-align:right; }
  .invoice-title { font-size:28px; font-weight:300; color:#1a3a2a; letter-spacing:0.1em; text-transform:uppercase; }
  .invoice-ref   { font-size:13px; color:#6b7280; margin-top:4px; }
  .invoice-ref strong { color:#1a3a2a; }
  .status-pill {
    display:inline-block; padding:3px 12px; border-radius:20px;
    font-size:10px; font-weight:700; letter-spacing:0.15em;
    background:${statusColor}20; color:${statusColor};
    border:1px solid ${statusColor}; margin-top:6px;
  }
  ${isVoided ? '.body-content { opacity:0.6; }' : ''}
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; padding-bottom:24px; border-bottom:1px solid #e5e7eb; }
  .party h4 { font-size:9px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#4a8c5c; margin-bottom:10px; padding-bottom:4px; border-bottom:2px solid #c8e6c0; display:inline-block; }
  .party-name { font-size:16px; font-weight:700; color:#1a1a1a; margin-bottom:6px; }
  .party-detail { font-size:12px; color:#4b5563; line-height:1.7; }
  .vat-tag { display:inline-block; background:#1a3a2a; color:white; font-size:9px; font-weight:600; padding:2px 8px; border-radius:3px; margin-top:6px; letter-spacing:0.08em; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  thead tr { background:#1a3a2a; }
  thead th { padding:10px 14px; text-align:left; font-size:9px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:#c8e6c0; }
  thead th:not(:first-child) { text-align:right; }
  tbody tr { border-bottom:1px solid #f3f4f6; }
  tbody tr:hover { background:#f9fafb; }
  tbody td { padding:14px; font-size:13px; color:#1a1a1a; }
  tbody td:not(:first-child) { text-align:right; }
  .item-vin { font-size:10px; color:#6b7280; font-family:monospace; margin-top:3px; }
  .totals-wrap { display:flex; justify-content:flex-end; margin-bottom:32px; }
  .totals-box { width:260px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
  .totals-row { display:flex; justify-content:space-between; padding:9px 14px; font-size:12px; color:#4b5563; border-bottom:1px solid #f3f4f6; }
  .totals-row.total { background:#1a3a2a; padding:13px 14px; }
  .totals-row.total span { font-size:16px; font-weight:700; color:white; }
  .totals-row.total .label { font-size:10px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#c8e6c0; display:flex; align-items:center; }
  .payment-section { margin-bottom:32px; }
  .payment-section h4 { font-size:9px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#4a8c5c; margin-bottom:10px; }
  .payment-pill { display:inline-flex; align-items:center; gap:6px; background:#c8e6c020; border:1px solid #c8e6c0; padding:6px 14px; border-radius:6px; font-size:12px; font-weight:600; color:#1a3a2a; margin-bottom:10px; }
  .payments-history { margin-bottom:24px; }
  .payments-history h4 { font-size:9px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#4a8c5c; margin-bottom:10px; padding-bottom:4px; border-bottom:2px solid #c8e6c0; display:inline-block; }
  .payments-table { width:100%; border-collapse:collapse; font-size:11px; }
  .payments-table th { background:#f9fafb; padding:7px 10px; text-align:left; font-size:9px; font-weight:600; letter-spacing:0.15em; text-transform:uppercase; color:#6b7280; border-bottom:1px solid #e5e7eb; }
  .payments-table th:not(:first-child) { text-align:right; }
  .payments-table td { padding:8px 10px; border-bottom:1px solid #f3f4f6; color:#1a1a1a; }
  .payments-table td:not(:first-child) { text-align:right; }
  .payments-table tfoot td { background:#fffbeb; font-weight:700; color:#92400e; border:none; }
  .state-footer { padding:12px 16px; border-radius:8px; margin-bottom:24px; font-size:12px; font-weight:600; }
  .state-footer.pending { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
  .state-footer.partial { background:#ffedd5; color:#9a3412; border:1px solid #fed7aa; }
  .state-footer.paid    { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
  .bank-details { font-size:11px; color:#4b5563; line-height:1.8; background:#f9fafb; padding:10px 14px; border-radius:6px; border:1px solid #e5e7eb; }
  /* v1.0.2: official company stamp replaces the seller signature text.
     Centered container, aspect-preserved sizing with hard caps so wide
     or tall uploads stay within a predictable A4 footprint. */
  .stamp-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 15px 0 24px 0;
  }
  .stamp {
    max-width: 200px;
    max-height: 200px;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
  }
  .footer { background:#1a3a2a; margin:0 -40px -40px; padding:18px 40px; display:flex; justify-content:space-between; align-items:center; }
  .footer-item { display:flex; flex-direction:column; gap:2px; }
  .footer-label { font-size:8px; font-weight:600; letter-spacing:0.2em; text-transform:uppercase; color:#4a8c5c; }
  .footer-value { font-size:10px; color:#c8e6c0; }
  .bottom-bar { height:3px; background:#4a8c5c; margin:0 -40px; }

  /* v1.0.2 — single A4 page fit for print. Browser Ctrl+P → Save as PDF
     should produce one page for a typical 1–5 line-item invoice. Invoices
     with >10 items may overflow; that's acceptable for v1.0.2 and can be
     revisited in v1.1 if it becomes a real problem. */
  @page {
    size: A4 portrait;
    margin: 10mm;
  }
  @media print {
    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
    }
    body {
      padding: 8mm;
      font-size: 11px;
      max-width: 194mm;
    }
    .top-bar { height:3px; margin-bottom:14px; }
    .header { margin-bottom:16px; }
    .invoice-title { font-size:22px; }
    .parties { gap:20px; margin-bottom:16px; padding-bottom:12px; }
    .party-name { font-size:14px; margin-bottom:4px; }
    .party-detail { font-size:10px; line-height:1.4; }
    table { margin-bottom:14px; }
    thead th { padding:6px 10px; font-size:9px; }
    tbody td { padding:8px 10px; font-size:11px; }
    .totals-wrap { margin-bottom:16px; }
    .totals-box { width:240px; }
    .totals-row { padding:6px 12px; font-size:11px; }
    .totals-row.total { padding:9px 12px; }
    .totals-row.total span { font-size:14px; }
    .payment-section { margin-bottom:16px; }
    .state-footer { padding:9px 14px; margin-bottom:16px; font-size:11px; }
    .payments-history { margin-bottom:14px; }
    .payments-table { font-size:10px; }
    .payments-table th { padding:5px 8px; }
    .payments-table td { padding:5px 8px; }
    .stamp-container { margin: 10px 0 14px 0; }
    .stamp { max-width:160px; max-height:160px; }
    /* Don't let the stamp, totals, or footer orphan onto a second page */
    .totals-wrap, .stamp-container, .footer, .state-footer, .payments-history {
      page-break-inside: avoid;
    }
    .footer { margin:0 -8mm -8mm; padding:10px 8mm; }
    .bottom-bar { margin:0 -8mm; }
  }
</style>
</head>
<body>

<div class="top-bar"></div>

<div class="header">
  <div class="logo-area">
    <div class="logo-name">VITESSE ECO</div>
    <div class="logo-sub">Fatbikes électriques premium</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-title">Facture</div>
    <div class="invoice-ref">N° <strong>${invoice.ref_code}</strong></div>
    <div class="invoice-ref">Date : <strong>${invoice.date}</strong></div>
    <div class="status-pill">${statusLabel}</div>
  </div>
</div>

<div class="body-content">

<div class="parties">
  <div class="party">
    <h4>Vendeur</h4>
    <div class="party-name">${shopName}</div>
    <div class="party-detail">
      ${shopAddress}<br>
      ${shopCity}<br>
      ${shopEmail}<br>
      ${shopWebsite}
    </div>
    ${shopVAT && !shopVAT.includes('compléter')
      ? `<div class="vat-tag">N° TVA : ${shopVAT}</div>`
      : ''}
  </div>
  <div class="party">
    <h4>Client</h4>
    <div class="party-name">${invoice.client_name}</div>
    <div class="party-detail">
      ${invoice.client_address ? invoice.client_address + '<br>' : ''}
      ${invoice.client_phone  ? 'Tél : ' + invoice.client_phone + '<br>' : ''}
      ${invoice.client_email  ? invoice.client_email : ''}
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Désignation</th>
      <th>Qté</th>
      <th>Prix Unit. HT</th>
      <th>Total HT</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <strong>${invoice.item}</strong>
        ${invoice.vin ? `<div class="item-vin">N° Série / VIN : ${invoice.vin}</div>` : ''}
      </td>
      <td>${invoice.quantity}</td>
      <td>${fmt(parseFloat(invoice.unit_price) / (1 + vatRate / 100))}</td>
      <td>${fmt(totalHT)}</td>
    </tr>
  </tbody>
</table>

<div class="totals-wrap">
  <div class="totals-box">
    <div class="totals-row">
      <span>Sous-total HT</span>
      <span>${fmt(totalHT)}</span>
    </div>
    <div class="totals-row">
      <span>TVA (${vatRate}%)</span>
      <span>${fmt(vatAmount)}</span>
    </div>
    <div class="totals-row total">
      <span class="label">TOTAL TTC</span>
      <span>${fmt(totalTTC)}</span>
    </div>
  </div>
</div>

${payments.length > 0 ? `
<div class="payments-history">
  <h4>Historique des règlements</h4>
  <table class="payments-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Mode</th>
        <th>Montant TTC</th>
        <th>TVA (${vatRate}%)</th>
      </tr>
    </thead>
    <tbody>
      ${payments.map((p) => {
        const methodLabel = p.payment_method === 'بنك' ? 'Virement' : 'Espèces';
        return `<tr>
          <td>${p.date || ''}</td>
          <td>${methodLabel}</td>
          <td>${fmt(parseFloat(p.amount) || 0)}</td>
          <td>${fmt(parseFloat(p.tva_amount) || 0)}</td>
        </tr>`;
      }).join('')}
    </tbody>
    ${stateKey !== 'paid' ? `
    <tfoot>
      <tr>
        <td colspan="2">Solde restant</td>
        <td colspan="2">${fmt(remaining)}</td>
      </tr>
    </tfoot>` : ''}
  </table>
</div>` : ''}

${!isVoided && stateKey === 'pending' ? `
<div class="state-footer pending">
  ⏳ En attente de règlement${dpe > 0.005 ? ` — Acompte attendu à la livraison : ${fmt(dpe)}` : ''}
</div>` : ''}
${!isVoided && stateKey === 'partial' ? `
<div class="state-footer partial">
  ⚠️ Solde restant : ${fmt(remaining)} — à régler ultérieurement
</div>` : ''}
${!isVoided && stateKey === 'paid' ? `
<div class="state-footer paid">
  ✓ PAYÉE EN INTÉGRALITÉ
</div>` : ''}

<div class="payment-section">
  <h4>Mode de paiement</h4>
  <div class="payment-pill">${payLabel}</div>
  ${shopIBAN && !shopIBAN.includes('compléter') ? `
  <div class="bank-details">
    <strong>IBAN :</strong> ${shopIBAN}<br>
    <strong>BIC :</strong> ${shopBIC}<br>
    <strong>Référence :</strong> ${invoice.ref_code}
  </div>` : ''}
</div>

<!-- v1.0.2: official company stamp replaces the text signature block.
     File served from /stamp.png (public/stamp.png). Smart sizing via
     the .stamp CSS class keeps it proportional for any aspect ratio. -->
<div class="stamp-container">
  <img src="/stamp.png" alt="Cachet officiel - VITESSE ECO" class="stamp" />
</div>

</div><!-- end body-content -->

<div class="bottom-bar"></div>
<div class="footer">
  <div class="footer-item">
    <span class="footer-label">Informations légales</span>
    <span class="footer-value">SIRET : ${shopSiret}</span>
    <span class="footer-value">SIREN : ${shopSiren}</span>
    <span class="footer-value">APE : ${settings.shop_ape || '46.90Z'}</span>
  </div>
  <div class="footer-item" style="text-align:center; align-items:center;">
    <span class="footer-label">Vendeur</span>
    <span class="footer-value">${invoice.seller_name || ''}</span>
    <span class="footer-label" style="margin-top:4px;">Livreur</span>
    <span class="footer-value">${invoice.driver_name || ''}</span>
  </div>
  <div class="footer-item" style="text-align:right; align-items:flex-end;">
    <span class="footer-label">Contact</span>
    <span class="footer-value">${shopEmail}</span>
    <span class="footer-value">${shopWebsite}</span>
    <span class="footer-value" style="margin-top:6px; font-size:8px; color:#4a8c5c;">
      Généré le ${new Date().toLocaleDateString('fr-FR')}
    </span>
  </div>
</div>

</body>
</html>`;
}
