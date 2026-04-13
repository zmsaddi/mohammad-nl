// BUG-28: unit tests for lib/voice-blacklist.js — phrase blacklist and
// suspicious-length heuristic. Does NOT exercise silence detection
// (that needs a real MediaStream and is covered by manual QA).
//
// Run with:  npx vitest run tests/bug28-voice-blacklist.test.js

import { describe, it, expect } from 'vitest';
import {
  BLACKLIST_PHRASES,
  isBlacklisted,
  isSuspiciouslyLongWithoutAction,
} from '../lib/voice-blacklist.js';

describe('BUG-28: isBlacklisted — phrase matching', () => {
  it('returns false for empty/null/undefined input', () => {
    expect(isBlacklisted('')).toBe(false);
    expect(isBlacklisted(null)).toBe(false);
    expect(isBlacklisted(undefined)).toBe(false);
    expect(isBlacklisted(42)).toBe(false);
  });

  it('rejects the canonical Arabic YouTube hallucination', () => {
    expect(isBlacklisted('اشتركوا في القناة')).toBe(true);
  });

  it('rejects the singular form of subscribe-to-channel', () => {
    expect(isBlacklisted('اشترك في القناة')).toBe(true);
  });

  it('rejects a blacklisted phrase embedded in a longer transcription', () => {
    // Whisper sometimes produces a real sentence suffix plus the boilerplate
    expect(isBlacklisted('السلام عليكم اشتركوا في القناة ولا تنسوا')).toBe(true);
  });

  it('rejects bracketed Arabic music marker', () => {
    expect(isBlacklisted('[موسيقى]')).toBe(true);
  });

  it('rejects bracketed English music marker (case insensitive)', () => {
    expect(isBlacklisted('[Music]')).toBe(true);
    expect(isBlacklisted('[MUSIC]')).toBe(true);
    expect(isBlacklisted('[music]')).toBe(true);
  });

  it('rejects English YouTube boilerplate', () => {
    expect(isBlacklisted('thanks for watching my video')).toBe(true);
    expect(isBlacklisted('Please like and subscribe')).toBe(true);
    expect(isBlacklisted("DON'T FORGET TO SUBSCRIBE")).toBe(true);
  });

  it('rejects French YouTube boilerplate', () => {
    expect(isBlacklisted("merci d'avoir regardé")).toBe(true);
    expect(isBlacklisted('Abonnez-vous')).toBe(true);
  });

  // CRITICAL: this is the reason the blacklist is phrase-based, not
  // word-based. The existing lib/voice-prompt-builder:208 maps plain
  // "موسيقى" to a Bluetooth speaker product alias. If we blacklist the
  // word, the seller can't legitimately say "بعت موسيقى" (I sold a
  // music [player]) which is the exact use case the alias supports.
  it('does NOT reject plain word "موسيقى" (preserves Bluetooth speaker alias)', () => {
    expect(isBlacklisted('موسيقى')).toBe(false);
  });

  it('does NOT reject a sentence containing "موسيقى" as a product name', () => {
    expect(isBlacklisted('اشتريت موسيقى من السوق')).toBe(false);
    expect(isBlacklisted('بعت موسيقى لزبون')).toBe(false);
  });

  it('does NOT reject a legitimate sale sentence', () => {
    expect(isBlacklisted('بعت خمسة فيشن كاش')).toBe(false);
  });

  it('exports a non-empty BLACKLIST_PHRASES array', () => {
    expect(Array.isArray(BLACKLIST_PHRASES)).toBe(true);
    expect(BLACKLIST_PHRASES.length).toBeGreaterThan(5);
    // Every phrase should be a non-empty string
    for (const p of BLACKLIST_PHRASES) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });
});

describe('BUG-28: isSuspiciouslyLongWithoutAction — soft warning heuristic', () => {
  it('returns false for empty/null/undefined', () => {
    expect(isSuspiciouslyLongWithoutAction('')).toBe(false);
    expect(isSuspiciouslyLongWithoutAction(null)).toBe(false);
    expect(isSuspiciouslyLongWithoutAction(undefined)).toBe(false);
  });

  it('returns false for short text even without verbs', () => {
    expect(isSuspiciouslyLongWithoutAction('مرحبا')).toBe(false);
    expect(isSuspiciouslyLongWithoutAction('الجو جميل')).toBe(false);
  });

  it('returns false for long text WITH a sell/buy verb', () => {
    expect(isSuspiciouslyLongWithoutAction(
      'بعت خمسة دراجات كهربائية للزبون أحمد كاش اليوم في المحل'
    )).toBe(false);
    expect(isSuspiciouslyLongWithoutAction(
      'اشتريت عشرة فيشن من المورد وحيد بخمسمية يورو للواحدة'
    )).toBe(false);
  });

  it('returns false for long text with an expense verb', () => {
    expect(isSuspiciouslyLongWithoutAction(
      'صرفت على إيجار المحل خمسمية يورو هذا الشهر كاش'
    )).toBe(false);
  });

  it('returns true for long text with no action verbs at all', () => {
    // Hypothetical hallucination: a long weather observation
    expect(isSuspiciouslyLongWithoutAction(
      'اليوم الجو جميل جداً والشمس مشرقة والسماء صافية والطيور تغرد'
    )).toBe(true);
  });

  it('returns true for a long English-language hallucination with no verbs', () => {
    // Whisper sometimes falls into English mid-stream
    expect(isSuspiciouslyLongWithoutAction(
      'hello everyone how are you today I hope you are all doing well'
    )).toBe(true);
  });
});
