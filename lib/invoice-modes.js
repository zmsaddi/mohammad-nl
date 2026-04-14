// FEAT-04: invoice generation abstraction layer.
//
// Separates the invoice-rendering strategy from the PDF route so the
// codebase can switch between legal approaches without touching route
// handlers. Current strategies:
//
//   'single_facture_three_states' — one invoice number per sale,
//      evolves through EN ATTENTE → PARTIELLE → PAYÉE. This is what
//      ships in FEAT-04 after Accountant Q3 confirmed it.
//
//   'facture_d_acompte_separate' — split facture d'acompte (down
//      payment receipt) and final facture. Stub throws NOT_IMPLEMENTED
//      as a deliberate forcing function until Accountant Q4 returns a
//      final decision. Don't remove the stub — the error message is
//      how we know we haven't silently defaulted.

import { generateInvoiceHTML } from './invoice-generator';

/**
 * @param {Object} invoice  invoices row + joined sales fields
 *   (payment_status, down_payment_expected)
 * @param {Object} settings flat settings map from getSettings()
 * @param {Array}  payments collection payment rows for this sale
 * @param {string} [mode='single_facture_three_states']
 * @returns {string} HTML document
 */
export function generateInvoiceBody(
  invoice,
  settings,
  payments = [],
  mode = 'single_facture_three_states'
) {
  if (mode === 'single_facture_three_states') {
    return generateInvoiceHTML(invoice, settings, payments);
  }
  if (mode === 'facture_d_acompte_separate') {
    throw new Error(
      "NOT_IMPLEMENTED — pending accountant guidance on Facture d'acompte separation"
    );
  }
  throw new Error(`Unknown invoice mode: ${mode}`);
}
