// FEAT-04: invoice-modes.js abstraction + three-state rendering tests.
//
// Pure-function unit tests (no DB). Exercises generateInvoiceBody routing
// and the three-state pill / payments history block in the generator.
//
// Run with: npx vitest run tests/feat04-invoice-modes.test.js

import { describe, it, expect } from 'vitest';
import { generateInvoiceBody } from '../lib/invoice-modes.js';
import { generateInvoiceHTML } from '../lib/invoice-generator.js';

const baseInvoice = {
  id: 1,
  ref_code: 'INV-202604-001',
  date: '2026-04-14',
  client_name: 'Test Client',
  client_phone: '+31612345678',
  client_email: 'test@example.com',
  client_address: 'Test Address',
  item: 'Test Bike',
  quantity: 1,
  unit_price: 1500,
  total: 1500,
  payment_type: 'كاش',
  vin: 'VIN-TEST',
  seller_name: 'Seller',
  driver_name: 'Driver',
  status: 'مؤكد',
  sale_id: 1,
};

const baseSettings = {
  shop_name: 'VITESSE ECO SAS',
  shop_siret: '123456789',
  shop_siren: '123456789',
  shop_vat_number: 'FR123',
  shop_iban: 'FR76...',
  shop_bic: 'BNPAFRPP',
  vat_rate: '20',
  invoice_currency: 'EUR',
};

describe('FEAT-04: generateInvoiceBody mode routing', () => {
  it('single_facture_three_states returns HTML', () => {
    const html = generateInvoiceBody(baseInvoice, baseSettings, [], 'single_facture_three_states');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('INV-202604-001');
  });

  it('defaults to single_facture_three_states when mode omitted', () => {
    const html = generateInvoiceBody(baseInvoice, baseSettings);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('facture_d_acompte_separate throws NOT_IMPLEMENTED', () => {
    expect(() =>
      generateInvoiceBody(baseInvoice, baseSettings, [], 'facture_d_acompte_separate')
    ).toThrow(/NOT_IMPLEMENTED/);
  });

  it('unknown mode throws', () => {
    expect(() =>
      generateInvoiceBody(baseInvoice, baseSettings, [], 'some_other_mode')
    ).toThrow(/Unknown invoice mode/);
  });
});

describe('FEAT-04: three-state pill rendering', () => {
  it('pending state when payment_status=pending', () => {
    const inv = { ...baseInvoice, payment_status: 'pending', down_payment_expected: 500 };
    const html = generateInvoiceHTML(inv, baseSettings, []);
    expect(html).toContain('EN ATTENTE');
    expect(html).not.toContain('>PAYÉE<');
  });

  it('partial state renders PARTIELLE', () => {
    const inv = { ...baseInvoice, payment_status: 'partial', down_payment_expected: 500 };
    const payments = [
      { date: '2026-04-14', amount: 500, payment_method: 'كاش', tva_amount: 83.33 },
    ];
    const html = generateInvoiceHTML(inv, baseSettings, payments);
    expect(html).toContain('PARTIELLE');
    expect(html).toContain('Solde restant');
  });

  it('paid state renders PAYÉE', () => {
    const inv = { ...baseInvoice, payment_status: 'paid', down_payment_expected: 1500 };
    const payments = [
      { date: '2026-04-14', amount: 1500, payment_method: 'كاش', tva_amount: 250 },
    ];
    const html = generateInvoiceHTML(inv, baseSettings, payments);
    expect(html).toContain('PAYÉE');
    expect(html).toContain('PAYÉE EN INTÉGRALITÉ');
  });

  it('cancelled state overrides payment_status with ANNULÉE', () => {
    const inv = { ...baseInvoice, status: 'ملغي', payment_status: 'paid' };
    const html = generateInvoiceHTML(inv, baseSettings, []);
    expect(html).toContain('ANNULÉE');
  });
});

describe('FEAT-04: payments history block', () => {
  it('does not render block when payments array is empty', () => {
    const html = generateInvoiceHTML(
      { ...baseInvoice, payment_status: 'pending' },
      baseSettings,
      []
    );
    expect(html).not.toContain('Historique des règlements');
  });

  it('renders payments table with all rows when payments present', () => {
    const payments = [
      { date: '2026-04-10', amount: 500, payment_method: 'كاش', tva_amount: 83.33 },
      { date: '2026-04-14', amount: 300, payment_method: 'بنك', tva_amount: 50 },
    ];
    const html = generateInvoiceHTML(
      { ...baseInvoice, payment_status: 'partial', total: 1500 },
      baseSettings,
      payments
    );
    expect(html).toContain('Historique des règlements');
    expect(html).toContain('2026-04-10');
    expect(html).toContain('2026-04-14');
    expect(html).toContain('Espèces');
    expect(html).toContain('Virement');
  });
});
