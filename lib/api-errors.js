// v1.1 S4.7 [F-057] — unified error helper for API routes.
//
// Pre-v1.1 each route had its own "is this error safe to return?"
// check, using 3 different implementations:
//   - /^[\u0600-\u06FF]/.test(err.message)  — Arabic first-char test
//   - .includes('غير موجود')                — substring match
//   - no check at all                        — generic message
//
// This module provides a single `apiError(err, fallback)` that:
//   1. Checks if the error message starts with an Arabic char (safe)
//   2. If safe, returns the real message to the client
//   3. If not safe, returns the fallback message (hides internals)
//   4. Always logs the full error server-side
//
// Usage:
//   catch (err) {
//     return apiError(err, 'خطأ في إضافة البيانات');
//   }

import { NextResponse } from 'next/server';

/**
 * Build a safe error response. Arabic-prefixed error messages from
 * lib/db/* are treated as user-facing (they were written for the
 * user by design). Everything else is hidden behind `fallback`.
 *
 * @param {Error|unknown} err     The caught error
 * @param {string} fallback       Arabic fallback message for non-safe errors
 * @param {number} [status=400]   HTTP status code
 * @param {string} [logPrefix=''] Prefix for the server-side console.error
 * @returns {NextResponse}
 */
export function apiError(err, fallback, status = 400, logPrefix = '') {
  const msg = err?.message || String(err);
  const safe = /^[\u0600-\u06FF]/.test(msg);
  if (logPrefix || !safe) {
    // eslint-disable-next-line no-console
    console.error(`${logPrefix ? `[${logPrefix}] ` : ''}${msg}`);
  }
  return NextResponse.json(
    { error: safe ? msg : fallback },
    { status }
  );
}
