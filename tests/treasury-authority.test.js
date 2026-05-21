// Treasury authority logic — pure functions managesBox / validTransferPair.
// These gate who can initiate/confirm/reject transfers, so they are the heart
// of the treasury permission model. Mocked DB import (functions are pure).
//
// Run with:  npx vitest run tests/treasury-authority.test.js

import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/postgres', () => ({
  sql: Object.assign(async () => ({ rows: [] }), { query: async () => ({ rows: [] }) }),
}));

describe('managesBox (admin → own+general, manager → own+drivers, driver → own)', () => {
  it('only admin manages the general (main) box', async () => {
    const { managesBox } = await import('../lib/db.js');
    expect(managesBox('admin', 'a1', { type: 'main' })).toBe(true);
    expect(managesBox('manager', 'm1', { type: 'main' })).toBe(false);
    expect(managesBox('driver', 'd1', { type: 'main' })).toBe(false);
  });

  it('a user manages their OWN custody box only', async () => {
    const { managesBox } = await import('../lib/db.js');
    const box = { type: 'custody', owner_username: 'd1', owner_role: 'driver' };
    expect(managesBox('driver', 'd1', box)).toBe(true);
    expect(managesBox('driver', 'd2', box)).toBe(false);
  });

  it('a manager manages drivers boxes, but NOT other managers or admins', async () => {
    const { managesBox } = await import('../lib/db.js');
    expect(managesBox('manager', 'm1', { type: 'custody', owner_username: 'd1', owner_role: 'driver' })).toBe(true);
    expect(managesBox('manager', 'm1', { type: 'custody', owner_username: 'm2', owner_role: 'manager' })).toBe(false);
    expect(managesBox('manager', 'm1', { type: 'custody', owner_username: 'a1', owner_role: 'admin' })).toBe(false);
  });

  it('an admin does NOT manage other peoples custody (view-only there)', async () => {
    const { managesBox } = await import('../lib/db.js');
    expect(managesBox('admin', 'a1', { type: 'custody', owner_username: 'd1', owner_role: 'driver' })).toBe(false);
  });

  it('seller / null box → false', async () => {
    const { managesBox } = await import('../lib/db.js');
    expect(managesBox('seller', 's1', { type: 'custody', owner_username: 's1', owner_role: 'seller' })).toBe(true); // own box (defensive)
    expect(managesBox('admin', 'a1', null)).toBe(false);
  });
});

describe('validTransferPair (no same-role custody↔custody; same box invalid)', () => {
  it('rejects driver↔driver and manager↔manager', async () => {
    const { validTransferPair } = await import('../lib/db.js');
    expect(validTransferPair({ id: 1, type: 'custody', owner_role: 'driver' }, { id: 2, type: 'custody', owner_role: 'driver' })).toBe(false);
    expect(validTransferPair({ id: 1, type: 'custody', owner_role: 'manager' }, { id: 2, type: 'custody', owner_role: 'manager' })).toBe(false);
  });

  it('allows custody↔general and different-level custody', async () => {
    const { validTransferPair } = await import('../lib/db.js');
    expect(validTransferPair({ id: 1, type: 'custody', owner_role: 'driver' }, { id: 2, type: 'main' })).toBe(true);
    expect(validTransferPair({ id: 1, type: 'custody', owner_role: 'driver' }, { id: 2, type: 'custody', owner_role: 'manager' })).toBe(true);
  });

  it('rejects the same box and missing boxes', async () => {
    const { validTransferPair } = await import('../lib/db.js');
    expect(validTransferPair({ id: 1, type: 'custody' }, { id: 1, type: 'custody' })).toBe(false);
    expect(validTransferPair(null, { id: 2, type: 'main' })).toBe(false);
  });
});
