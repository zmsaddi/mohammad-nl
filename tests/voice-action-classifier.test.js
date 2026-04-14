import { describe, test, expect } from 'vitest';
import { classifyAction } from '@/lib/voice-action-classifier';

describe('voice action classifier', () => {
  describe('sale verbs', () => {
    test('recognizes بعت', () => {
      expect(classifyAction('بعت دراجة لأحمد بألف')).toBe('sale');
    });
    test('recognizes بعنا', () => {
      expect(classifyAction('بعنا خمس دراجات اليوم')).toBe('sale');
    });
  });

  describe('purchase verbs', () => {
    test('recognizes اشتريت', () => {
      expect(classifyAction('اشتريت خمس دراجات من المورد')).toBe('purchase');
    });
    test('recognizes شريت', () => {
      expect(classifyAction('شريت عشرة عجلات')).toBe('purchase');
    });
    test('recognizes جبت', () => {
      expect(classifyAction('جبت دراجتين')).toBe('purchase');
    });
  });

  describe('expense verbs', () => {
    test('recognizes دفعت + راتب', () => {
      expect(classifyAction('دفعت راتب السائق')).toBe('expense');
    });
    test('recognizes صرفت', () => {
      expect(classifyAction('صرفت على البنزين')).toBe('expense');
    });
  });

  describe('contextual بات handling', () => {
    test('بات + لـ + client → sale', () => {
      expect(classifyAction('بات دراجة لأحمد بألف')).toBe('sale');
    });
    test('بات + سعر بيع → sale', () => {
      expect(classifyAction('بات PRODUCT_A للعميل بخمسمية')).toBe('sale');
    });
    test('بات alone without context → null (fall through to LLM)', () => {
      expect(classifyAction('بات السائق متعب')).toBe(null);
    });
  });

  describe('no match', () => {
    test('empty input → null', () => {
      expect(classifyAction('')).toBe(null);
    });
    test('unrelated text → null', () => {
      expect(classifyAction('الجو حلو اليوم')).toBe(null);
    });
    test('null input → null', () => {
      expect(classifyAction(null)).toBe(null);
    });
    test('undefined input → null', () => {
      expect(classifyAction(undefined)).toBe(null);
    });
    test('non-string input → null', () => {
      expect(classifyAction(42)).toBe(null);
    });
  });
});
