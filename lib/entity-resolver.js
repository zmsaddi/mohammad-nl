/**
 * Entity Resolution System - 3 Layer Pipeline
 * Layer 0: Learned aliases (instant, from entity_aliases table)
 * Layer 1: Fuse.js fuzzy matching (handles typos, partial names)
 * Layer 2: Passthrough (return raw text for LLM to handle)
 */

import Fuse from 'fuse.js';
import { normalizeForMatching } from './voice-normalizer';
import { findAlias, getAllAliases } from './db';

// In-memory cache for Fuse indexes (rebuilt every 60s)
const cache = { products: null, clients: null, suppliers: null, ts: 0 };
const CACHE_TTL = 60000; // 60 seconds

/**
 * Build Fuse.js search index from entities + their aliases
 * @param {Array} entities - [{id, name, ...}]
 * @param {Array} aliases - [{entity_id, alias}]
 * @returns {Fuse}
 */
function buildFuseIndex(entities, aliases) {
  const items = [];

  for (const entity of entities) {
    // Add the canonical name
    items.push({
      id: entity.id,
      name: entity.name,
      normalized: normalizeForMatching(entity.name),
      source: 'canonical',
    });

    // Add aliases for this entity
    const entityAliases = aliases.filter((a) => a.entity_id === entity.id);
    for (const alias of entityAliases) {
      items.push({
        id: entity.id,
        name: entity.name,
        normalized: alias.normalized_alias,
        alias: alias.alias,
        source: 'alias',
        frequency: alias.frequency || 1,
      });
    }
  }

  return new Fuse(items, {
    keys: [
      { name: 'name', weight: 0.4 },
      { name: 'normalized', weight: 0.4 },
      { name: 'alias', weight: 0.2 },
    ],
    threshold: 0.4,          // 0 = exact, 1 = match anything
    distance: 100,
    includeScore: true,
    minMatchCharLength: 2,
  });
}

/**
 * Resolve an entity name through 3 layers
 * @param {string} rawText - What the user/Whisper said
 * @param {'product'|'client'|'supplier'} entityType
 * @param {Array} entities - Full list from DB [{id, name, ...}]
 * @returns {Promise<{status: string, entity?: object, confidence?: string, method?: string, candidates?: Array}>}
 */
export async function resolveEntity(rawText, entityType, entities) {
  if (!rawText || !entities.length) {
    return { status: 'not_found' };
  }

  const normalized = normalizeForMatching(rawText);

  // === LAYER 0: Learned Aliases (fastest) ===
  const aliasMatch = await findAlias(entityType, normalized);
  if (aliasMatch) {
    const entity = entities.find((e) => e.id === aliasMatch.entity_id);
    if (entity) {
      return {
        status: 'matched',
        entity: { id: entity.id, name: entity.name, type: entityType },
        confidence: 'high',
        method: 'learned',
      };
    }
  }

  // Check exact normalized match against entity names
  for (const entity of entities) {
    if (normalizeForMatching(entity.name) === normalized) {
      return {
        status: 'matched',
        entity: { id: entity.id, name: entity.name, type: entityType },
        confidence: 'high',
        method: 'exact',
      };
    }
  }

  // === LAYER 1: Fuse.js Fuzzy Match ===
  try {
    // Get or build cached index
    const now = Date.now();
    if (!cache[entityType] || now - cache.ts > CACHE_TTL) {
      const aliases = await getAllAliases(entityType);
      cache[entityType] = buildFuseIndex(entities, aliases);
      cache.ts = now;
    }

    const fuse = cache[entityType];
    if (fuse) {
      const results = fuse.search(rawText, { limit: 3 });

      if (results.length > 0) {
        const best = results[0];
        const score = best.score; // 0 = perfect match

        if (score < 0.2) {
          // High confidence match
          return {
            status: 'matched',
            entity: { id: best.item.id, name: best.item.name, type: entityType },
            confidence: 'high',
            method: 'fuzzy',
          };
        } else if (score < 0.4) {
          // Medium confidence
          return {
            status: 'matched',
            entity: { id: best.item.id, name: best.item.name, type: entityType },
            confidence: 'medium',
            method: 'fuzzy',
          };
        } else if (score < 0.6 && results.length > 1) {
          // Ambiguous - return candidates
          return {
            status: 'ambiguous',
            candidates: results.slice(0, 3).map((r) => ({
              entity: { id: r.item.id, name: r.item.name, type: entityType },
              confidence: r.score < 0.4 ? 'medium' : 'low',
            })),
          };
        }
      }
    }
  } catch {}

  // === LAYER 2: Not found - pass through ===
  return { status: 'not_found' };
}

/**
 * Invalidate cache (call after adding new entities or aliases)
 */
export function invalidateCache() {
  cache.products = null;
  cache.clients = null;
  cache.suppliers = null;
  cache.ts = 0;
}
