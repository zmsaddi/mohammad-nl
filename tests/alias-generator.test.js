// FEAT-01: tests for lib/alias-generator.js
//
// Generator-only tests. Integration into addProduct/addSupplier/addClient
// is in Commit 2 of FEAT-01 and tested separately via the existing
// sale-lifecycle integration test.
//
// Run with: npx vitest run tests/alias-generator.test.js

import { describe, it, expect } from 'vitest';
import {
  generateProductAliases,
  generateSupplierAliases,
  generateClientAliases,
} from '../lib/alias-generator.js';

// ----------------------------------------------------------------------------
// PRODUCT — happy paths
// ----------------------------------------------------------------------------

describe('generateProductAliases — happy paths', () => {
  it('V20 Pro produces full Arabic, canonical, and a typing-friendly variant', () => {
    const r = generateProductAliases('V20 Pro');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('في عشرين برو');
    expect(r.aliases).toContain('V20 Pro');
    // The lowercase form 'v20 pro' is intentionally NOT a separate alias —
    // it normalizes to the same key as 'V20 Pro' under normalizeForMatching
    // (which lowercases), so the resolver matches typed "v20 pro" against
    // the canonical alias just fine. We do produce one mixed-eastern variant
    // ("V٢٠ برو") and one spaceless lowercase ("v20pro") — distinct
    // normalized forms that catch separate typing patterns.
    expect(r.aliases).toContain('v20pro');
    expect(r.aliases.length).toBeLessThanOrEqual(5);
  });

  it('V8 Ultra produces both Levantine and Gulf number forms', () => {
    const r = generateProductAliases('V8 Ultra');
    expect(r.skip).toBe(false);
    // Gulf form
    expect(r.aliases).toContain('في ثمانية ألترا');
    // Levantine form
    expect(r.aliases).toContain('في تمنية ألترا');
  });

  it('S20 Pro produces إس عشرين برو', () => {
    const r = generateProductAliases('S20 Pro');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('إس عشرين برو');
  });

  it('Q30 Pliable produces كيو ثلاثين قابلة للطي and Levantine variant', () => {
    const r = generateProductAliases('Q30 Pliable');
    expect(r.skip).toBe(false);
    // Either Gulf or Levantine form of 30 should appear
    const hasOne = r.aliases.some(a =>
      a.includes('كيو ثلاثين') || a.includes('كيو تلاتين')
    );
    expect(hasOne).toBe(true);
  });

  it('EB30 (multi-letter prefix) produces إي بي ثلاثين', () => {
    const r = generateProductAliases('EB30');
    expect(r.skip).toBe(false);
    const hasOne = r.aliases.some(a =>
      a.includes('إي بي ثلاثين') || a.includes('إي بي تلاتين')
    );
    expect(hasOne).toBe(true);
  });

  it('V20 Mini produces في عشرين ميني', () => {
    const r = generateProductAliases('V20 Mini');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('في عشرين ميني');
  });

  it('GT-2000 (hyphenated number) produces جي تي ألفين', () => {
    const r = generateProductAliases('GT-2000');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('جي تي ألفين');
  });

  it('C28 (compositional number) produces سي ثمانية وعشرين', () => {
    const r = generateProductAliases('C28');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('سي ثمانية وعشرين');
  });
});

// ----------------------------------------------------------------------------
// PRODUCT — skip cases
// ----------------------------------------------------------------------------

describe('generateProductAliases — skip cases', () => {
  it('empty string is skipped', () => {
    const r = generateProductAliases('');
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('empty');
    expect(r.aliases).toEqual([]);
  });

  it('whitespace-only is skipped', () => {
    const r = generateProductAliases('   ');
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('empty');
  });

  it('Arabic-only name is skipped', () => {
    const r = generateProductAliases('دراجة كهربائية');
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('already_arabic');
  });

  it('overly long name (>100 chars) is skipped', () => {
    const r = generateProductAliases('A'.repeat(150));
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('too_long');
  });
});

// ----------------------------------------------------------------------------
// PRODUCT — variant suffix handling
// ----------------------------------------------------------------------------

describe('generateProductAliases — variant suffix stripping', () => {
  it('"V20 Pro - Noir - NFC" generates aliases for the BASE name only', () => {
    const r = generateProductAliases('V20 Pro - Noir - NFC');
    expect(r.skip).toBe(false);
    // Base aliases present
    expect(r.aliases).toContain('في عشرين برو');
    expect(r.aliases).toContain('V20 Pro');
    // Variant tokens should NOT appear in any alias (deferred per spec)
    for (const a of r.aliases) {
      expect(a).not.toContain('Noir');
      expect(a).not.toContain('NFC');
      expect(a).not.toContain('نوار');
      expect(a).not.toContain('إن إف سي');
    }
  });

  it('"V20 Pro - Black" strips the color suffix', () => {
    const r = generateProductAliases('V20 Pro - Black');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('في عشرين برو');
    for (const a of r.aliases) {
      expect(a).not.toContain('Black');
      expect(a).not.toContain('بلاك');
      expect(a).not.toContain('أسود');
    }
  });
});

// ----------------------------------------------------------------------------
// PRODUCT — edge cases
// ----------------------------------------------------------------------------

describe('generateProductAliases — edge cases', () => {
  it('mixed Latin/Arabic input does not crash and returns something', () => {
    const r = generateProductAliases('V20 برو');
    expect(r.skip).toBe(false);
    expect(r.aliases.length).toBeGreaterThan(0);
  });

  it('Sur-Ron Light Bee X (mostly unknown brand) produces something useful', () => {
    const r = generateProductAliases('Sur-Ron Light Bee X');
    expect(r.skip).toBe(false);
    expect(r.aliases.length).toBeGreaterThan(0);
    // Canonical form must be present. Lowercase variant collapses under
    // normalize-dedup so we don't assert it separately. The spaceless variant
    // catches the "user types without spaces" case.
    expect(r.aliases).toContain('Sur-Ron Light Bee X');
    expect(r.aliases).toContain('sur-ronlightbeex');
  });

  it('all aliases respect MAX_ALIAS_LEN (50)', () => {
    const r = generateProductAliases('V20 Pro Premium Limited Edition Special Cross Ultra Plus');
    for (const a of r.aliases) {
      expect(a.length).toBeLessThanOrEqual(50);
    }
  });

  it('alias count never exceeds 5 for products', () => {
    const r = generateProductAliases('V20 Pro');
    expect(r.aliases.length).toBeLessThanOrEqual(5);
  });
});

// ----------------------------------------------------------------------------
// SUPPLIER
// ----------------------------------------------------------------------------

describe('generateSupplierAliases', () => {
  it('"Sami Trading" produces سامي + سامي ترايدنغ + canonical', () => {
    const r = generateSupplierAliases('Sami Trading');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('سامي');
    expect(r.aliases).toContain('سامي ترايدنغ');
    expect(r.aliases).toContain('Sami Trading');
  });

  it('"Mohammed Ali Group" produces محمد علي قروب', () => {
    const r = generateSupplierAliases('Mohammed Ali Group');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('محمد علي قروب');
    // First-token should also be present (the personal name)
    expect(r.aliases).toContain('محمد');
  });

  it('empty supplier is skipped', () => {
    const r = generateSupplierAliases('');
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('empty');
  });

  it('alias count never exceeds 4 for suppliers', () => {
    const r = generateSupplierAliases('Sami Trading');
    expect(r.aliases.length).toBeLessThanOrEqual(4);
  });
});

// ----------------------------------------------------------------------------
// CLIENT
// ----------------------------------------------------------------------------

describe('generateClientAliases', () => {
  it('"Mohammed Ali" produces محمد, علي, محمد علي', () => {
    const r = generateClientAliases('Mohammed Ali');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('محمد علي');
    expect(r.aliases).toContain('محمد');
    expect(r.aliases).toContain('علي');
  });

  it('"Mohammed Ali Khalid" (3 tokens) produces full + first + last', () => {
    const r = generateClientAliases('Mohammed Ali Khalid');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('محمد علي خالد');
    expect(r.aliases).toContain('محمد');
    expect(r.aliases).toContain('خالد');
  });

  it('"Ahmed" (single token) produces أحمد', () => {
    const r = generateClientAliases('Ahmed');
    expect(r.skip).toBe(false);
    expect(r.aliases).toContain('أحمد');
  });

  it('empty client is skipped', () => {
    const r = generateClientAliases('');
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('empty');
  });

  it('Arabic-only client name is skipped', () => {
    const r = generateClientAliases('محمد');
    expect(r.skip).toBe(true);
    expect(r.reason).toBe('already_arabic');
  });

  it('alias count never exceeds 4 for clients', () => {
    const r = generateClientAliases('Mohammed Ali Khalid');
    expect(r.aliases.length).toBeLessThanOrEqual(4);
  });
});
