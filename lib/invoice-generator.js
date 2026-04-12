// DONE: Step 2
// Standalone HTML invoice generator for VITESSE ECO SAS.
// Pure function — takes invoice row + settings dict, returns a complete HTML
// document. Caller is responsible for delivering it (the PDF route serves it
// inline so the browser can render and the user can Ctrl+P to PDF).

/**
 * @param {Object} invoice  invoices table row
 * @param {Object} settings flat key→value map from getSettings()
 * @returns {string} full HTML document
 */
export function generateInvoiceHTML(invoice, settings) {
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

  // Status
  const isVoided = invoice.status === 'ملغي';
  const statusLabel = isVoided ? 'ANNULÉE' : 'CONFIRMÉE';
  const statusColor = isVoided ? '#dc2626' : '#16a34a';

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
  .bank-details { font-size:11px; color:#4b5563; line-height:1.8; background:#f9fafb; padding:10px 14px; border-radius:6px; border:1px solid #e5e7eb; }
  .signatures { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; }
  .sig-block h4 { font-size:9px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#4a8c5c; margin-bottom:10px; }
  .sig-box { height:70px; border:1px dashed #d1d5db; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; }
  .sig-box span { font-size:11px; color:#9ca3af; font-style:italic; }
  .footer { background:#1a3a2a; margin:0 -40px -40px; padding:18px 40px; display:flex; justify-content:space-between; align-items:center; }
  .footer-item { display:flex; flex-direction:column; gap:2px; }
  .footer-label { font-size:8px; font-weight:600; letter-spacing:0.2em; text-transform:uppercase; color:#4a8c5c; }
  .footer-value { font-size:10px; color:#c8e6c0; }
  .bottom-bar { height:3px; background:#4a8c5c; margin:0 -40px; }
  @media print {
    body { padding:20px; }
    .footer { margin:0 -20px -20px; padding:12px 20px; }
    .bottom-bar { margin:0 -20px; }
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

<div class="signatures">
  <div class="sig-block">
    <h4>Signature du vendeur</h4>
    <div class="sig-box"><span>Signature autorisée</span></div>
  </div>
  <div class="sig-block">
    <h4>Bon pour accord — Client</h4>
    <div class="sig-box"><span>Signature du client</span></div>
  </div>
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
