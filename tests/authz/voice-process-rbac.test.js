// v1.1 S1.4 — F-067 regression test (FALSE POSITIVE lockdown)
//
// Domain 5 audit agent reported POST /api/voice/process had no role
// check. Manual inspection at commit 427f2c3 proved this wrong —
// app/api/voice/process/route.js:45 enforces ['admin','manager','seller']
// AND has a per-user sliding-window rate limit (10 req/min). Drivers
// return 403.
//
// Lock the driver-blocked behavior. We don't exercise the Groq path
// (that would require mocking audio + Whisper + Llama); the test only
// needs to prove the role gate fires BEFORE the request body is even
// parsed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getProducts: vi.fn(async () => []),
  getClients: vi.fn(async () => []),
  getSuppliers: vi.fn(async () => []),
  getAIPatterns: vi.fn(async () => []),
  getRecentCorrections: vi.fn(async () => []),
  getTopEntities: vi.fn(async () => []),
}));
vi.mock('@/lib/voice-normalizer', () => ({ normalizeArabicText: (s) => s }));
vi.mock('@/lib/entity-resolver', () => ({ resolveEntity: () => null }));
vi.mock('@/lib/voice-prompt-builder', () => ({ buildVoiceSystemPrompt: () => '' }));
vi.mock('@/lib/voice-blacklist', () => ({
  isBlacklisted: () => false,
  isSuspiciouslyLongWithoutAction: () => false,
}));
vi.mock('@/lib/voice-action-classifier', () => ({ classifyAction: () => null }));
vi.mock('@/lib/utils', () => ({
  EXPENSE_CATEGORIES: [],
  PAYMENT_MAP: {},
  CATEGORY_MAP: {},
}));
vi.mock('@vercel/postgres', () => ({ sql: vi.fn() }));
vi.mock('groq-sdk', () => ({
  default: class MockGroq {
    constructor() {}
  },
}));

const getTokenMock = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args) => getTokenMock(...args),
}));

let POST;
beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('@/app/api/voice/process/route.js');
  POST = mod.POST;
});

afterEach(() => {
  vi.resetModules();
});

// Request with no audio — but role gate fires before body is touched.
function makeRequest() {
  return {
    formData: async () => new Map(),
  };
}

describe('F-067 regression — POST /api/voice/process driver blocked', () => {
  it('driver is rejected 403 (role gate fires before audio is read)', async () => {
    getTokenMock.mockResolvedValueOnce({ username: 'driver1', role: 'driver' });
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it('unauthenticated is rejected 401', async () => {
    getTokenMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});
