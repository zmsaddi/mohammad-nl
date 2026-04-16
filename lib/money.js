// v1.1 F-011/F-012/F-016 — money rounding + TVA helpers.
//
// Centralizes the rounding discipline the app uses so future sites
// don't drift. Pre-v1.1 every callsite hardcoded `/ 6` (the 20% TVA
// shortcut) and `Math.round(x * 100) / 100` inline, which made the
// VAT rate impossible to change via settings and the rounding
// behavior impossible to audit from one place.
//
// No dependencies. Pure functions. Safe to import from both server
// (lib/db.js) and client code ('use client' pages).

/**
 * Round a money amount to 2 decimal places. Matches the inline
 * `Math.round(x * 100) / 100` discipline used throughout the app.
 * @param {number} n
 * @returns {number}
 */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Extract the TVA (French VAT) amount from a TTC (incl-tax) price.
 *
 * Formula: TVA = TTC × rate / (100 + rate)
 *
 * For the hardcoded 20% case the shortcut `amount / 6` was
 * equivalent (20/120 = 1/6). Pre-v1.1 several callsites baked in
 * the shortcut, which silently broke if settings.vat_rate changed.
 * This helper makes the rate explicit so callers pass it in.
 *
 * @param {number|string} ttcAmount  TTC/incl-tax amount
 * @param {number|string} ratePercent  VAT rate as a percentage (20 = 20%)
 * @returns {number}  TVA amount, rounded to 2 decimals
 */
export function tvaFromTtc(ttcAmount, ratePercent) {
  const amount = parseFloat(ttcAmount) || 0;
  const rate = parseFloat(ratePercent) || 0;
  if (rate <= 0 || amount === 0) return 0;
  return round2((amount * rate) / (100 + rate));
}

/**
 * Extract the HT (pre-tax) amount from a TTC price.
 * HT = TTC − TVA.
 * @param {number|string} ttcAmount
 * @param {number|string} ratePercent
 * @returns {number}
 */
export function htFromTtc(ttcAmount, ratePercent) {
  const amount = parseFloat(ttcAmount) || 0;
  const tva = tvaFromTtc(amount, ratePercent);
  return round2(amount - tva);
}

/**
 * Convert a money amount to cents (integer) for accumulation-safe sums.
 * @param {number|string} amount
 * @returns {number}
 */
export function toCents(amount) {
  return Math.round((parseFloat(amount) || 0) * 100);
}

/**
 * Convert cents back to a money amount.
 * @param {number} cents
 * @returns {number}
 */
export function fromCents(cents) {
  return (cents | 0) / 100;
}
