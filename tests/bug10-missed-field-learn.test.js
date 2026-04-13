// BUG-10: missed-field corrections are now recorded.
//
// The filter in `app/api/voice/learn/route.js` used to drop corrections
// when the AI never emitted the field — which made unlearnable any
// field the LLM consistently missed. The new filter records any case
// where the user provided a value, tagging missed-field scenarios with
// aiValue='(missing)' as a self-documenting marker.
//
// Run with: npx vitest run tests/bug10-missed-field-learn.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saveAICorrectionMock = vi.fn(async () => {});
const sqlMock = vi.fn(async () => ({ rows: [] }));

vi.mock('@/lib/db', () => ({
  saveAICorrection: saveAICorrectionMock,
}));

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ username: 'test-seller' })),
}));

vi.mock('@vercel/postgres', () => ({
  sql: (...args) => sqlMock(...args),
}));

function buildRequest(body) {
  return { json: async () => body };
}

async function callLearn(body) {
  const { POST } = await import('../app/api/voice/learn/route.js');
  return POST(buildRequest(body));
}

describe('BUG-10: learn route records missed-field corrections', () => {
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveAICorrectionMock.mockClear();
    sqlMock.mockClear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('case 1: AI emitted no sell_price, user added 1500 → one correction with ai_output="(missing)"', async () => {
    await callLearn({
      transcript: 'اشتريت V20 بألف سعر البيع ألف وخمسمية',
      aiData:     { item: 'V20', unit_price: 1000 },
      userData:   { item: 'V20', unit_price: 1000, sell_price: 1500 },
      actionType: 'register_purchase',
    });

    const calls = saveAICorrectionMock.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      fieldName: 'sell_price',
      aiValue:   '(missing)',
      userValue: '1500',
      actionType: 'register_purchase',
    });
  });

  it('case 2: AI emitted wrong sell_price=1400, user corrected to 1500 → existing wrong-value path still works', async () => {
    await callLearn({
      transcript: 'اشتريت V20 بألف سعر البيع ألف وخمسمية',
      aiData:     { item: 'V20', unit_price: 1000, sell_price: 1400 },
      userData:   { item: 'V20', unit_price: 1000, sell_price: 1500 },
      actionType: 'register_purchase',
    });

    const calls = saveAICorrectionMock.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      fieldName: 'sell_price',
      aiValue:   '1400',
      userValue: '1500',
    });
    expect(calls[0][0].aiValue).not.toBe('(missing)');
  });

  it('case 3: AI and user both agree, user added nothing → zero corrections', async () => {
    await callLearn({
      transcript: 'اشتريت V20 بألف',
      aiData:     { item: 'V20', unit_price: 1000 },
      userData:   { item: 'V20', unit_price: 1000 },
      actionType: 'register_purchase',
    });

    expect(saveAICorrectionMock).not.toHaveBeenCalled();
  });

  it('case 4: AI emitted nothing, user filled in three fields → three corrections all tagged missing', async () => {
    await callLearn({
      transcript: 'اشتريت V20 بألف سعر البيع ألف وخمسمية',
      aiData:     {},
      userData:   { item: 'V20', unit_price: 1000, sell_price: 1500 },
      actionType: 'register_purchase',
    });

    const calls = saveAICorrectionMock.mock.calls;
    expect(calls).toHaveLength(3);
    const byField = Object.fromEntries(calls.map((c) => [c[0].fieldName, c[0]]));
    expect(byField.item).toMatchObject({ aiValue: '(missing)', userValue: 'V20' });
    expect(byField.unit_price).toMatchObject({ aiValue: '(missing)', userValue: '1000' });
    expect(byField.sell_price).toMatchObject({ aiValue: '(missing)', userValue: '1500' });
  });

  it('case 5: AI emitted empty-string unit_price, user supplied 1000 → recorded as missed', async () => {
    await callLearn({
      transcript: 'اشتريت V20 بألف',
      aiData:     { item: 'V20', unit_price: '' },
      userData:   { item: 'V20', unit_price: 1000 },
      actionType: 'register_purchase',
    });

    const calls = saveAICorrectionMock.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      fieldName: 'unit_price',
      aiValue:   '(missing)',
      userValue: '1000',
    });
  });
});
