-- v1.2 Migration 002 — unique index on entity_aliases.
--
-- Pre-v1.2 the entity_aliases table had a non-unique lookup index
-- (idx_entity_aliases_lookup). seedProductAliases and autoLearnFromHistory
-- both do check-then-insert (SELECT WHERE → INSERT) which races on
-- concurrent cold starts, producing duplicate aliases.
--
-- This migration adds a UNIQUE index that replaces the non-unique one.
-- Duplicates are cleaned up first (keep the lowest-id row per pair).

-- Step 1: Delete duplicates, keeping the row with the smallest id.
DELETE FROM entity_aliases a
WHERE EXISTS (
  SELECT 1 FROM entity_aliases b
  WHERE b.entity_type = a.entity_type
    AND b.normalized_alias = a.normalized_alias
    AND b.id < a.id
);

-- Step 2: Drop the old non-unique index.
DROP INDEX IF EXISTS idx_entity_aliases_lookup;

-- Step 3: Create the unique index on the same columns.
CREATE UNIQUE INDEX idx_entity_aliases_unique
  ON entity_aliases (entity_type, normalized_alias);
