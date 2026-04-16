import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Voice System Defect Fix Regression Tests
// Covers: DEFECT-001, 003, 004, 005, 006, 011, 014
// ============================================================

// --- Mocks (hoisted before dynamic imports) ---

const mockGetProducts = vi.fn(async () => []);
const mockGetClients = vi.fn(async () => []);
const mockGetSuppliers = vi.fn(async () => []);
const mockGetAIPatterns = vi.fn(async () => []);
const mockGetRecentCorrections = vi.fn(async () => []);
const mockGetTopEntities = vi.fn(async () => ({ products: [], clients: [], suppliers: [], aliases: [] }));
const mockAddAlias = vi.fn(async () => {});
const mockSaveAICorrection = vi.fn(async () => {});

vi.mock('@/lib/db', () => ({
  getProducts: mockGetProducts,
  getClients: mockGetClients,
  getSuppliers: mockGetSuppliers,
  getAIPatterns: mockGetAIPatterns,
  getRecentCorrections: mockGetRecentCorrections,
  getTopEntities: mockGetTopEntities,
  addAlias: mockAddAlias,
  saveAICorrection: mockSaveAICorrection,
}));

const mockSql = vi.fn(async () => ({ rows: [] }));
mockSql.query = vi.fn(async () => ({ rows: [] }));
vi.mock('@vercel/postgres', () => ({
  sql: mockSql,
}));

const mockGetToken = vi.fn(async () => null);
vi.mock('next-auth/jwt', () => ({
  getToken: mockGetToken,
}));

const mockNormalize = vi.fn((text) => text);
const mockNormalizeForMatching = vi.fn((text) => text?.toLowerCase?.() || '');
vi.mock('@/lib/voice-normalizer', () => ({
  normalizeArabicText: mockNormalize,
  normalizeForMatching: mockNormalizeForMatching,
}));

vi.mock('@/lib/entity-resolver', () => ({
  resolveEntity: vi.fn(async () => ({ match: 'not_found' })),
}));

vi.mock('@/lib/voice-prompt-builder', () => ({
  buildVoiceSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('@/lib/voice-blacklist', () => ({
  isBlacklisted: vi.fn(() => false),
  isSuspiciouslyLongWithoutAction: vi.fn(() => false),
}));

vi.mock('@/lib/voice-action-classifier', () => ({
  classifyAction: vi.fn(() => null),
}));

vi.mock('@/lib/utils', () => ({
  EXPENSE_CATEGORIES: ['إيجار', 'بنزين', 'أخرى'],
  PAYMENT_MAP: { cash: 'كاش', bank: 'بنك', credit: 'آجل' },
  CATEGORY_MAP: {},
  formatNumber: vi.fn((n) => String(n)),
  getTodayDate: vi.fn(() => '2026-04-17'),
  PRODUCT_CATEGORIES: [],
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async (req, roles) => {
    const token = await mockGetToken({ req });
    if (!token) return { error: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) };
    if (roles && !roles.includes(token.role)) return { error: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) };
    return { token };
  }),
}));

vi.mock('@/lib/api-errors', () => ({
  apiError: vi.fn((err, msg, status) => new Response(JSON.stringify({ error: msg }), { status: status || 500, headers: { 'Content-Type': 'application/json' } })),
}));

// Mock Groq SDK
const mockWhisperCreate = vi.fn(async () => ({ text: 'بعت لأحمد دراجة بألف' }));
const mockChatCreate = vi.fn(async () => ({
  choices: [{ message: { content: JSON.stringify({ action: 'register_sale', client_name: 'أحمد', item: 'V20 Pro', quantity: 1, unit_price: 1000, payment_type: 'cash' }) } }],
}));

vi.mock('groq-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockWhisperCreate } },
    chat: { completions: { create: mockChatCreate } },
  })),
}));

// --- Helper: build a fake Request with FormData ---
function makeAudioRequest(type = 'audio/webm', size = 1000) {
  const blob = new Blob([new ArrayBuffer(size)], { type });
  const formData = new FormData();
  formData.set('audio', blob, 'recording.webm');
  return {
    formData: async () => formData,
    headers: { get: () => 'Bearer test' },
  };
}

function makeJsonRequest(body) {
  return {
    json: async () => body,
    headers: { get: () => 'Bearer test' },
  };
}

// ============================================================
// SECTION 1: DEFECT-001 — MIME Type Validation
// ============================================================
describe('DEFECT-001: MIME type validation', () => {
  let POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue({ username: 'admin', role: 'admin' });
    const mod = await import('@/app/api/voice/process/route.js');
    POST = mod.POST;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('rejects non-audio MIME types with 400', async () => {
    const blob = new Blob(['not audio'], { type: 'application/pdf' });
    const formData = new FormData();
    formData.set('audio', blob, 'document.pdf');
    const req = { formData: async () => formData, headers: { get: () => 'Bearer t' } };

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('ليس صوتياً');
  });

  it('accepts audio/webm MIME type', async () => {
    const req = makeAudioRequest('audio/webm');
    const res = await POST(req);
    // Should proceed past MIME check (may fail later on Groq mock, but not 400 for MIME)
    expect(res.status).not.toBe(400);
  });

  it('accepts application/octet-stream (browser fallback)', async () => {
    const req = makeAudioRequest('application/octet-stream');
    const res = await POST(req);
    expect(res.status).not.toBe(400);
  });
});

// ============================================================
// SECTION 2: DEFECT-006 — No fire-and-forget alias writes
// ============================================================
describe('DEFECT-006: No premature alias writes in process route', () => {
  let POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue({ username: 'admin', role: 'admin' });
    mockAddAlias.mockClear();
    const mod = await import('@/app/api/voice/process/route.js');
    POST = mod.POST;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('does NOT call addAlias during voice processing', async () => {
    const req = makeAudioRequest();
    await POST(req);
    expect(mockAddAlias).not.toHaveBeenCalled();
  });
});

// ============================================================
// SECTION 3: DEFECT-014 — addAlias uses ON CONFLICT
// ============================================================
describe('DEFECT-014: addAlias atomic upsert', () => {
  it('source code uses ON CONFLICT instead of SELECT-then-UPDATE', async () => {
    const src = await import('fs').then(fs =>
      fs.promises.readFile('d:/mohammad_nl/lib/db.js', 'utf8')
    );
    // Find the addAlias function body
    const fnStart = src.indexOf('export async function addAlias(');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.substring(fnStart, fnEnd);

    expect(fnBody).toContain('ON CONFLICT');
    expect(fnBody).toContain('DO UPDATE SET');
    expect(fnBody).not.toContain('SELECT id FROM entity_aliases');
  });
});

// ============================================================
// SECTION 4: DEFECT-003 — Permission boundary tests
// ============================================================
describe('DEFECT-003: Role-based action filtering', () => {
  describe('voice/process route RBAC', () => {
    let POST;

    beforeEach(async () => {
      vi.clearAllMocks();
      const mod = await import('@/app/api/voice/process/route.js');
      POST = mod.POST;
    });

    afterEach(() => {
      vi.resetModules();
    });

    it('blocks driver from using voice endpoint', async () => {
      mockGetToken.mockResolvedValue({ username: 'driver1', role: 'driver' });
      const req = makeAudioRequest();
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('allows seller to use voice endpoint', async () => {
      mockGetToken.mockResolvedValue({ username: 'seller1', role: 'seller' });
      const req = makeAudioRequest();
      const res = await POST(req);
      expect(res.status).not.toBe(403);
    });
  });

  describe('VoiceConfirm ACTION_ROLES constant', () => {
    it('seller can only access register_sale', async () => {
      // Import the module to check the ACTION_ROLES constant is applied
      // This is a structural verification — the canUseAction filter exists
      const src = await import('fs').then(fs =>
        fs.promises.readFile('d:/mohammad_nl/components/VoiceConfirm.js', 'utf8')
      );
      expect(src).toContain('ACTION_ROLES');
      expect(src).toContain("register_sale: ['admin', 'manager', 'seller']");
      expect(src).toContain("register_purchase: ['admin', 'manager']");
      expect(src).toContain("register_expense: ['admin', 'manager']");
      expect(src).toContain('canUseAction(action)');
      expect(src).toContain('.filter(([key]) => canUseAction(key))');
    });
  });
});

// ============================================================
// SECTION 5: DEFECT-004 — Learn AFTER save
// ============================================================
describe('DEFECT-004: Learn call ordering', () => {
  it('VoiceConfirm calls learn AFTER onConfirm, not before', async () => {
    const src = await import('fs').then(fs =>
      fs.promises.readFile('d:/mohammad_nl/components/VoiceConfirm.js', 'utf8')
    );

    const onConfirmIdx = src.indexOf('await onConfirm(endpoint, submitData)');
    const learnIdx = src.indexOf("fetch('/api/voice/learn'");

    expect(onConfirmIdx).toBeGreaterThan(-1);
    expect(learnIdx).toBeGreaterThan(-1);
    expect(learnIdx).toBeGreaterThan(onConfirmIdx);
  });

  it('learn call is inside the try block after save, not before', async () => {
    const src = await import('fs').then(fs =>
      fs.promises.readFile('d:/mohammad_nl/components/VoiceConfirm.js', 'utf8')
    );

    // The learn call should NOT appear before entity creation
    const entityCreateIdx = src.indexOf('const creates = []');
    const learnIdx = src.indexOf("fetch('/api/voice/learn'");
    expect(learnIdx).toBeGreaterThan(entityCreateIdx);

    // Verify the old pre-save learn pattern is gone
    expect(src).not.toContain("// BUG-10: voice learning is fire-and-forget");
  });
});

// ============================================================
// SECTION 6: DEFECT-005 — Duplicate submission prevention
// ============================================================
describe('DEFECT-005: Idempotency guard', () => {
  it('VoiceConfirm has submitted state guard', async () => {
    const src = await import('fs').then(fs =>
      fs.promises.readFile('d:/mohammad_nl/components/VoiceConfirm.js', 'utf8')
    );

    expect(src).toContain('const [submitted, setSubmitted] = useState(false)');
    expect(src).toContain('if (saving || submitted) return');
    expect(src).toContain('setSubmitted(true)');
  });

  it('submitted resets when new voice result arrives', async () => {
    const src = await import('fs').then(fs =>
      fs.promises.readFile('d:/mohammad_nl/components/VoiceConfirm.js', 'utf8')
    );

    expect(src).toContain('setSubmitted(false)');
  });
});

// ============================================================
// SECTION 7: DEFECT-011 — Entity creation error handling
// ============================================================
describe('DEFECT-011: Entity creation not silently swallowed', () => {
  it('client creation logs warnings instead of catch(() => {})', async () => {
    const src = await import('fs').then(fs =>
      fs.promises.readFile('d:/mohammad_nl/components/VoiceConfirm.js', 'utf8')
    );

    // The old pattern was .catch(() => {}) on client creation
    // New pattern should log warnings
    const clientCreateSection = src.substring(
      src.indexOf('const creates = []'),
      src.indexOf('if (creates.length)')
    );

    // Client creation should have .then with warning log
    expect(clientCreateSection).toContain('console.warn');
    // Supplier creation should also have .then with warning log
    expect(clientCreateSection).toContain("'[VoiceConfirm] client create:'");
    expect(clientCreateSection).toContain("'[VoiceConfirm] supplier create:'");
  });
});

// ============================================================
// SECTION 8: voice/learn route — PUT endpoint for action_id
// ============================================================
describe('voice/learn PUT — action_id linking', () => {
  let PUT;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue({ username: 'admin', role: 'admin' });
    const mod = await import('@/app/api/voice/learn/route.js');
    PUT = mod.PUT;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('updates voice_logs with action_id', async () => {
    const req = makeJsonRequest({ voiceLogId: 42, actionId: 99 });
    const res = await PUT(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('requires authentication', async () => {
    mockGetToken.mockResolvedValue(null);
    const req = makeJsonRequest({ voiceLogId: 42, actionId: 99 });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });
});

// ============================================================
// SECTION 9: voice/learn POST — no pollution from failed saves
// ============================================================
describe('Learning-data pollution prevention', () => {
  let learnPOST;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue({ username: 'seller1', role: 'seller' });
    const mod = await import('@/app/api/voice/learn/route.js');
    learnPOST = mod.POST;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('saves corrections when user changed AI output', async () => {
    mockSaveAICorrection.mockResolvedValue();
    const req = makeJsonRequest({
      transcript: 'بعت لأحمد',
      aiData: { client_name: 'محمد' },
      userData: { client_name: 'أحمد' },
      actionType: 'register_sale',
    });

    const res = await learnPOST(req);
    const body = await res.json();
    expect(body.corrections).toBe(1);
    expect(mockSaveAICorrection).toHaveBeenCalledWith(expect.objectContaining({
      aiValue: 'محمد',
      userValue: 'أحمد',
      fieldName: 'client_name',
    }));
  });

  it('does NOT save corrections when no changes made', async () => {
    const req = makeJsonRequest({
      transcript: 'بعت لأحمد',
      aiData: { client_name: 'أحمد', item: 'V20' },
      userData: { client_name: 'أحمد', item: 'V20' },
      actionType: 'register_sale',
    });

    const res = await learnPOST(req);
    const body = await res.json();
    expect(body.corrections).toBe(0);
    expect(mockSaveAICorrection).not.toHaveBeenCalled();
  });
});

// ============================================================
// SECTION 10: Failure injection — Groq API errors
// ============================================================
describe('Failure injection: Groq API errors', () => {
  let POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue({ username: 'admin', role: 'admin' });
    const mod = await import('@/app/api/voice/process/route.js');
    POST = mod.POST;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns 500 when Whisper transcription fails', async () => {
    mockWhisperCreate.mockRejectedValueOnce(new Error('Groq timeout'));
    const req = makeAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('returns 500 when LLM extraction fails', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('LLM error'));
    const req = makeAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
