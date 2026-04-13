/**
 * Entity Resolution System - Multi-Layer Pipeline
 * Layer 0: Learned aliases (instant O(1) lookup)
 * Layer 1: Multi-algorithm fuzzy (Fuse.js + Jaro-Winkler)
 * Layer 2: Context boosting (recent transactions rank higher)
 */

import Fuse from 'fuse.js';
import { sql } from '@vercel/postgres';
import { normalizeForMatching } from './voice-normalizer';
import { findAlias, getAllAliases } from './db';

// === JARO-WINKLER DISTANCE (Arabic transliteration matching) ===
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler boost for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// In-memory cache: each entity type has its own Fuse index AND its own timestamp,
// otherwise rebuilding one type would extend the TTL of unrelated stale indexes.
const cache = {
  products: { fuse: null, ts: 0 },
  clients: { fuse: null, ts: 0 },
  suppliers: { fuse: null, ts: 0 },
};
const CACHE_TTL = 300000; // 5 minutes

// DONE: Fix 4 — strip hyphens/spaces/punctuation for "v20pronoir"-style matching.
// Lets users type "v20pro", "V20Pro", or "v20-pro" and still find "V20 Pro".
function cleanForFuzzy(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[-\s]+/g, '')
    .replace(/[^\w]/g, '');
}

function buildFuseIndex(entities, aliases) {
  const items = [];
  for (const entity of entities) {
    items.push({
      id: entity.id,
      name: entity.name,
      normalized: normalizeForMatching(entity.name),
      normalized_clean: cleanForFuzzy(entity.name),
      source: 'canonical',
    });
    const entityAliases = aliases.filter((a) => a.entity_id === entity.id);
    for (const alias of entityAliases) {
      // DONE: Step 5A — frequency boost. Aliases used 20+ times get the full 0.3
      // bonus added to their fuzzy score, so heavily-used spoken aliases are
      // promoted over rarely-seen ones with similar fuzzy scores.
      const freqBoost = Math.min((alias.frequency || 1) / 20, 0.3);
      items.push({
        id: entity.id,
        name: entity.name,
        normalized: alias.normalized_alias,
        normalized_clean: cleanForFuzzy(alias.alias),
        alias: alias.alias,
        source: 'alias',
        frequency: alias.frequency || 1,
        freq_boost: freqBoost,
      });
    }
  }
  return new Fuse(items, {
    keys: [
      { name: 'name',             weight: 0.25 },
      { name: 'normalized',       weight: 0.35 },
      { name: 'normalized_clean', weight: 0.15 },
      { name: 'alias',            weight: 0.25 },
    ],
    threshold: 0.45,
    distance: 150,
    includeScore: true,
    minMatchCharLength: 2,
  });
}

/**
 * Resolve entity through multi-layer pipeline
 * @param {string} rawText
 * @param {'product'|'client'|'supplier'} entityType
 * @param {Array} entities - [{id, name, ...}]
 * @param {Object} context - {recentClients: [...], recentSuppliers: [...]}
 */
// FIXED: 2
// Helper: builds the not_found response, flagging products specifically
// so the route layer knows to suggest adding the new product to the catalogue.
function notFound(entityType) {
  return entityType === 'product'
    ? { status: 'not_found', isNewProduct: true }
    : { status: 'not_found' };
}

export async function resolveEntity(rawText, entityType, entities, context = {}) {
  if (!rawText || !entities.length) return notFound(entityType);

  const normalized = normalizeForMatching(rawText);

  // === LAYER 0: Learned Aliases (O(1) - instant) ===
  const aliasMatch = await findAlias(entityType, normalized);
  if (aliasMatch) {
    const entity = entities.find((e) => e.id === aliasMatch.entity_id);
    if (entity) {
      // DONE: Step 5B — bump frequency on every L0 hit so the most-used aliases
      // float to the top. Fire-and-forget; we never block the response on it.
      sql`
        UPDATE entity_aliases
        SET frequency = frequency + 1
        WHERE entity_type = ${entityType} AND normalized_alias = ${normalized}
      `.catch(() => {});
      return {
        status: 'matched',
        entity: { id: entity.id, name: entity.name, type: entityType },
        confidence: 'high',
        method: 'learned',
      };
    }
  }

  // Exact normalized match
  for (const entity of entities) {
    if (normalizeForMatching(entity.name) === normalized) {
      return { status: 'matched', entity: { id: entity.id, name: entity.name, type: entityType }, confidence: 'high', method: 'exact' };
    }
  }

  // === LAYER 1: Multi-Algorithm Fuzzy ===
  const candidates = [];

  // 1a. Fuse.js (per-type cache so unrelated rebuilds don't extend our TTL)
  try {
    const now = Date.now();
    const slot = cache[entityType] || (cache[entityType] = { fuse: null, ts: 0 });
    if (!slot.fuse || now - slot.ts > CACHE_TTL) {
      const aliases = await getAllAliases(entityType);
      slot.fuse = buildFuseIndex(entities, aliases);
      slot.ts = now;
    }
    const fuseResults = slot.fuse?.search(rawText, { limit: 5 }) || [];
    for (const r of fuseResults) {
      // DONE: Step 5A — propagate freq_boost from the indexed item into the candidate
      candidates.push({
        id: r.item.id,
        name: r.item.name,
        fuseScore: r.score,
        jwScore: 0,
        contextScore: 0,
        freq_boost: r.item.freq_boost || 0,
      });
    }
  } catch {}

  // 1b. Jaro-Winkler on all entities (catches transliteration matches)
  for (const entity of entities) {
    const jw = jaroWinkler(normalized, normalizeForMatching(entity.name));
    if (jw > 0.7) {
      const existing = candidates.find((c) => c.id === entity.id);
      if (existing) {
        existing.jwScore = jw;
      } else {
        candidates.push({ id: entity.id, name: entity.name, fuseScore: 1, jwScore: jw, contextScore: 0 });
      }
    }
  }

  // === LAYER 2: Context Boosting ===
  const recentNames = entityType === 'client' ? (context.recentClients || []) : entityType === 'supplier' ? (context.recentSuppliers || []) : [];
  for (const candidate of candidates) {
    const recentIndex = recentNames.indexOf(candidate.name);
    if (recentIndex !== -1) {
      candidate.contextScore = 0.3 - (recentIndex * 0.05); // More recent = higher boost
    }
  }

  // === SCORING: Combine all signals ===
  for (const c of candidates) {
    // Fuse: 0 = perfect, 1 = worst → invert
    const fuseNorm = 1 - Math.min(c.fuseScore, 1);
    // JW: 0 = worst, 1 = perfect
    const jwNorm = c.jwScore;
    // Context: 0-0.3 bonus
    // DONE: Step 5A — high-frequency aliases get an extra 0-0.3 bonus on top
    const freqBonus = c.freq_boost || 0;
    c.totalScore = (fuseNorm * 0.4) + (jwNorm * 0.35) + (c.contextScore * 0.25) + freqBonus;
  }

  // Sort by total score (highest first)
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  if (candidates.length > 0) {
    const best = candidates[0];
    if (best.totalScore > 0.6) {
      return { status: 'matched', entity: { id: best.id, name: best.name, type: entityType }, confidence: 'high', method: 'fuzzy+context', score: best.totalScore };
    } else if (best.totalScore > 0.35) {
      return { status: 'matched', entity: { id: best.id, name: best.name, type: entityType }, confidence: 'medium', method: 'fuzzy+context', score: best.totalScore };
    } else if (candidates.length > 1) {
      return { status: 'ambiguous', candidates: candidates.slice(0, 3).map((c) => ({ entity: { id: c.id, name: c.name, type: entityType }, confidence: 'low', score: c.totalScore })) };
    }
  }

  // FIXED: 2
  return notFound(entityType);
}

export function invalidateCache() {
  cache.products = { fuse: null, ts: 0 };
  cache.clients = { fuse: null, ts: 0 };
  cache.suppliers = { fuse: null, ts: 0 };
}
