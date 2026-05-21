// Shared, framework-free filtering primitives for every list page.
// Pure functions — unit-tested without a DB or React. This is the single place
// that defines "how matching works" so all 12 list pages behave identically.
//
// NOTE: intentionally self-contained — it does NOT reuse the voice layer's
// normalizer (lib/voice-normalizer.js), so the search behavior here can't
// regress the production voice/entity-resolution pipeline.

// Arabic-aware normalization for search matching. Ordered transforms:
// NFKC → strip tashkeel/tatweel → fold alef/taa-marbuta/alef-maqsura/hamza
// → fold Arabic-Indic & Persian digits to ASCII → lowercase → collapse spaces.
// So "أحمد"≈"احمد", "فاطمة"≈"فاطمه", "عيسى"≈"عيسي", "٠٦١٢"≈"0612".
export function normalizeArabic(input) {
  if (input == null) return '';
  let s = String(input);
  if (typeof s.normalize === 'function') s = s.normalize('NFKC');
  return s
    // tashkeel/harakat (064B-0652), Quranic marks (0610-061A, 06D6-06ED),
    // dagger alef (0670), tatweel (0640)
    .replace(/[ً-ْؐ-ؚـٰۖ-ۭ]/g, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ة/g, 'ه')                     // ة → ه
    .replace(/ى/g, 'ي')                     // ى → ي
    .replace(/ؤ/g, 'و')                     // ؤ → و
    .replace(/ئ/g, 'ي')                     // ئ → ي
    .replace(/ء/g, '')                           // ء → (removed)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩ → 0-9
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)) // ۰-۹ → 0-9
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Substring match with Arabic normalization + multi-token AND.
// `value` may be a single field or an array of fields (joined into one haystack
// so a multi-token query can span fields, e.g. "ahmad 0612" → name + phone).
// Every whitespace-separated query token must appear as a substring (order-
// independent). Empty query → matches everything. Exact-normalized (no fuzzy):
// every result provably contains what was typed — critical for financial data.
export function matchesText(value, query) {
  const q = normalizeArabic(query);
  if (!q) return true;
  const hay = normalizeArabic(Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
  if (!hay) return false;
  return q.split(' ').every((tok) => hay.includes(tok));
}

// Inclusive date-range test. Normalizes any date/timestamp to its 10-char ISO
// day ('YYYY-MM-DD') first, so TEXT date columns and TIMESTAMP created_at behave
// identically. Empty bounds pass through. Bounds are inclusive on both ends.
export function dateInRange(value, from, to) {
  if (!from && !to) return true;
  const d = String(value ?? '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// AND-compose an array of (row)=>bool predicates. A row survives only if every
// predicate passes. Falsy predicates are ignored, so callers can do
// `cond && ((r)=>...)`. Empty list → all rows pass.
export function applyFilters(rows, predicates) {
  if (!Array.isArray(rows)) return [];
  const preds = (predicates || []).filter(Boolean);
  if (!preds.length) return rows;
  return rows.filter((r) => preds.every((p) => p(r)));
}
