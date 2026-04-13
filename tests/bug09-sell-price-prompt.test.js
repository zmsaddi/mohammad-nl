// BUG-09: voice prompt teaches the LLM to extract sell_price from Arabic
// purchase voice input. These are unit tests on buildVoiceSystemPrompt —
// they assert that the produced prompt STRING contains the teaching
// signals we added. They do not (and cannot) validate LLM behavior;
// that requires live voice testing against the deployed model.
//
// Run with: npx vitest run tests/bug09-sell-price-prompt.test.js

import { describe, it, expect } from 'vitest';
import { buildVoiceSystemPrompt } from '../lib/voice-prompt-builder.js';

function buildDefault() {
  return buildVoiceSystemPrompt({
    products:  [{ name: 'V20 Pro' }],
    clients:   [],
    suppliers: [{ name: 'سامي' }],
    patterns:  [],
    corrections: [],
    recentSales: [],
    topClients: [],
    username: 'test-seller',
  });
}

describe('BUG-09: prompt teaches sell_price extraction', () => {
  const prompt = buildDefault();

  it('register_purchase schema lists sell_price as a field', () => {
    // The schema JSON block contains "sell_price" as a key.
    const schemaBlock = prompt.slice(
      prompt.indexOf('SCHEMA — شراء'),
      prompt.indexOf('SCHEMA — بيع')
    );
    expect(schemaBlock).toContain('"sell_price"');
  });

  it('synonym list contains سعر البيع', () => {
    expect(prompt).toContain('"سعر البيع"');
  });

  it('synonym list contains ريتيل (retail loanword)', () => {
    expect(prompt).toContain('"ريتيل"');
  });

  it('synonym list contains the additional spec phrases', () => {
    // Each of these was on the desired-synonyms list from the user's
    // BUG-09 report but was NOT present in the prompt before this commit.
    expect(prompt).toContain('"سعر المبيع"');
    expect(prompt).toContain('"سعر البيعة"');
    expect(prompt).toContain('"سعر البيع للزبون"');
    expect(prompt).toContain('"مبيع"');
    expect(prompt).toContain('"يبيع بـ"');
    expect(prompt).toContain('"أبيع بـ"');
    expect(prompt).toContain('"retail"');
  });

  it('prompt has at least one few-shot example where sell_price is a number', () => {
    // Our new example text: "سعر البيع ألف وخمسمية" → sell_price=1500
    expect(prompt).toContain('sell_price=1500');
  });

  it('prompt has at least one few-shot example where sell_price is null (regression guard)', () => {
    // The null example teaches the LLM NOT to hallucinate a value
    // when the user never mentioned a sell price.
    expect(prompt).toContain('sell_price=null');
  });

  it('prompt contains the explicit "do not guess" rule in Arabic', () => {
    expect(prompt).toContain('لا تخمّن');
  });

  it('prompt contains all four live-test phrasings as examples', () => {
    // These are the exact phrasings from the user's BUG-09 test matrix.
    expect(prompt).toContain('سعر البيع ألف وخمسمية');
    expect(prompt).toContain('نبيعها بثلاثة آلاف');
    expect(prompt).toContain('ريتيل ثلاثة آلاف');
    expect(prompt).toContain('أبيع الواحدة بألف وستمية');
  });
});
