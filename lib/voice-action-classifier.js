/**
 * Rule-based action classifier for voice transcription.
 *
 * Promoted from the inline fallback at app/api/voice/process/route.js:254-256
 * to handle action classification on ALL requests, not just clarification
 * branches. Protects against LLM sale↔purchase misclassification on
 * ambiguous or mis-heard verbs (e.g., "بعت" heard as "بات").
 *
 * Contract:
 *   input:  normalized Arabic text from the voice pipeline
 *   output: 'sale' | 'purchase' | 'expense' | null
 *
 * Used as a POST-LLM OVERRIDE in route.js: if the rule matches an
 * explicit verb and Llama's classification disagrees, trust the verb.
 * If the rule returns null, trust the LLM.
 *
 * Deterministic, zero LLM calls, safe to run on every request.
 */

// NOTE: no \b boundaries. JavaScript \b is defined against \w which excludes
// Arabic characters, so \b against Arabic text never fires (same pitfall
// documented in lib/voice-normalizer.js BUG-01d). Substring match is
// intentional — matches the behavior of the inline classifier this module
// replaces (route.js:254-256 used .includes() for the same reason).
const SALE_VERBS = /(بعت|بعنا|بيعت|بِعت|بعناها|بعناه|بعناهم|بيع)/;
const PURCHASE_VERBS = /(اشتريت|اشترينا|شريت|شرينا|جبت|جبنا|أخذت من|أخذنا من|استلمت من)/;
const EXPENSE_VERBS = /(دفعت|صرفت|راتب|أجار|إيجار|بنزين|وقود|فاتورة)/;

// Levantine colloquial: "بات" is often Whisper's mishearing of "بعت".
// When it appears near a client indicator (لـ / للعميل) or a sale-price
// marker (بألف / بمئة / بخمسمية / يورو), treat it as a sale. This is
// a known false-positive risk — monitor in production and tune in v1.1.
const BAT_SALE_CONTEXT = /بات.{0,40}(لـ|لِـ|للعميل|بألف|بمئة|بخمسمية|يورو)/;

export function classifyAction(text) {
  if (!text || typeof text !== 'string') return null;

  if (SALE_VERBS.test(text)) return 'sale';
  if (PURCHASE_VERBS.test(text)) return 'purchase';
  if (EXPENSE_VERBS.test(text)) return 'expense';

  if (BAT_SALE_CONTEXT.test(text)) return 'sale';

  return null;
}
