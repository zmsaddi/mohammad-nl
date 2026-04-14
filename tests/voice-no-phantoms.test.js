// Surgical voice detox: regression tests that assert no phantom entity
// names are produced by the normalizer after the hardcoded Vitesse
// catalog + في→V / بي→B letter mappings were deleted.
//
// Before the detox, common Arabic prepositions and nicknames were rewritten
// into SKUs:
//   "في عشرين برو"     → "V20 Pro"   (literal Whisper preposition → V20)
//   "بي عشرين"         → "B20"       (Whisper mis-hearing of في → B20)
//   "الفيشن"           → "V20 Pro"   (local nickname → hardcoded SKU)
//   "الميني" / "الطوي" → "V20 Mini" / "Q30 Pliable"
//
// These fired even on empty production DBs and produced phantom entities
// in VoiceConfirm with no corresponding product in the system. The detox
// pass moved catalog knowledge to the DB (topEntities + full catalog
// injection in route.js), where it belongs.

import { describe, test, expect } from 'vitest';
import { normalizeArabicText } from '@/lib/voice-normalizer';

describe('voice: no phantom entities on empty DB (post-detox)', () => {
  test('في عشرين برو → preserves Arabic, does not invent V20 Pro', () => {
    const result = normalizeArabicText('بعت في عشرين برو لأحمد');
    expect(result).not.toContain('V20 Pro');
    expect(result).not.toContain('B20');
  });

  test('بي عشرين برو → does not invent B20 Pro or V20 Pro', () => {
    const result = normalizeArabicText('بعت بي عشرين برو');
    expect(result).not.toContain('B20');
    expect(result).not.toContain('V20');
  });

  test('الفيشن → does not expand to V20 Pro', () => {
    const result = normalizeArabicText('اشتريت الفيشن');
    expect(result).not.toContain('V20 Pro');
    expect(result).not.toContain('V20');
  });

  test('الميني → does not expand to V20 Mini', () => {
    const result = normalizeArabicText('بعت الميني لسارة');
    expect(result).not.toContain('V20 Mini');
    expect(result).not.toContain('V20');
  });

  test('الطوي → does not expand to Q30 Pliable', () => {
    const result = normalizeArabicText('الطوي متوفر');
    expect(result).not.toContain('Q30');
    expect(result).not.toContain('Pliable');
  });

  test('الليمتد برو → does not expand to V20 Limited Pro', () => {
    const result = normalizeArabicText('اشتريت الليمتد برو');
    expect(result).not.toContain('V20 Limited Pro');
    expect(result).not.toContain('V20');
  });

  test('الكروس → does not expand to V20 Cross', () => {
    const result = normalizeArabicText('بعت الكروس');
    expect(result).not.toContain('V20 Cross');
    expect(result).not.toContain('V20');
  });

  test('الدوبل → does not expand to EB30', () => {
    const result = normalizeArabicText('اشتريت الدوبل');
    expect(result).not.toContain('EB30');
  });
});
