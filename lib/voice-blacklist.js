// BUG-28: Whisper hallucination defense at the server layer.
//
// When a user records silence or background noise, Whisper tends to fall back
// to high-frequency training-set phrases: YouTube boilerplate, applause
// markers, music markers, etc. Without this filter, those phrases reach the
// LLM extractor and fabricate plausible-looking sales/purchases (the user
// confirmed this during manual testing — four silent recordings produced
// four different hallucinated purchases).
//
// Matching is PHRASE-based, not word-based. A single word like "موسيقى"
// (music) has a legitimate commerce interpretation — lib/voice-prompt-builder
// maps it to a Bluetooth speaker alias — so blacklisting the word would break
// real speech. Phrases like "اشتركوا في القناة" (subscribe to the channel)
// have no commerce interpretation and are safe to reject outright.
//
// Start small, grow from voice_logs review. New phrases should be added only
// after observing them in production transcripts that clearly indicate
// hallucination.

export const BLACKLIST_PHRASES = [
  // Arabic YouTube boilerplate (the most common Whisper hallucination in AR)
  'اشتركوا في القناة',
  'اشترك في القناة',
  'لا تنسوا الاشتراك',
  'اضغط على زر الاشتراك',
  'شكراً على المشاهدة',
  'تابعونا على',
  'مرحباً بكم في قناتي',

  // English YouTube boilerplate (Whisper falls to English when AR is unclear)
  'subscribe to my channel',
  'thanks for watching',
  'please like and subscribe',
  "don't forget to subscribe",
  'hit the bell icon',
  'see you next time',

  // French YouTube boilerplate (project is a French SAS, FR locale on device)
  'abonnez-vous',
  "merci d'avoir regardé",
  "n'oubliez pas de liker",

  // Whisper non-speech markers (bracketed output on pure noise or silence).
  // The brackets matter — plain "موسيقى" in a sentence stays legal, but
  // "[موسيقى]" as the entire transcription is unambiguously non-speech.
  '[موسيقى]',
  '[music]',
  '[applause]',
  '[background noise]',
  '[noise]',
];

/**
 * Returns true if the transcription contains a blacklisted phrase as a
 * substring. Case-insensitive. Caller is expected to pass text that has
 * already been normalized via normalizeArabicText (so Alif variants,
 * tatweel, and spoken numerals are already canonical).
 *
 * @param {string} normalizedText
 * @returns {boolean}
 */
export function isBlacklisted(normalizedText) {
  if (!normalizedText || typeof normalizedText !== 'string') return false;
  const lower = normalizedText.toLowerCase();
  for (const phrase of BLACKLIST_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return true;
  }
  return false;
}

/**
 * Soft hallucination guard: transcription is longer than ~20 characters
 * but contains zero action verbs. Indicates the user said something real
 * but not commerce-related — e.g. "اليوم الجو جميل جداً في باريس" — which
 * the LLM will still try to extract a sale/purchase from.
 *
 * Does NOT reject. The caller pushes a warning onto the response so the
 * confirm dialog shows "review carefully" language.
 *
 * Action verbs covered: the same set the voice-prompt-builder teaches the
 * LLM (بعت/بيع/اشتريت/شريت/شراء/جبت) plus expense verbs (مصروف/صرفت/دفعت)
 * plus payment verbs (استلمت/قبض).
 *
 * @param {string} normalizedText
 * @returns {boolean}
 */
export function isSuspiciouslyLongWithoutAction(normalizedText) {
  if (!normalizedText || typeof normalizedText !== 'string') return false;
  if (normalizedText.length < 20) return false;
  const actionVerbs = /بعت|بيع|اشتريت|شريت|شراء|جبت|مصروف|صرفت|دفعت|استلمت|دفع|قبض/;
  return !actionVerbs.test(normalizedText);
}
