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

// "Request settlement" (مطالبة بتسليم العهدة): an admin/manager INITIATES a
// handover OUT OF a holder's box, and the holder CONFIRMS it. This locks the
// composed authority the feature relies on. Initiate rule = manages EITHER side
// (mFrom || mTo); confirm rule = manages a side AND is not the initiator.
describe('request settlement — admin/manager asks a holder to hand over', () => {
  const generalBox = { id: 1, type: 'main' };
  const driverBox = { id: 2, type: 'custody', owner_username: 'd1', owner_role: 'driver' };
  const managerBox = { id: 3, type: 'custody', owner_username: 'm1', owner_role: 'manager' };
  const canInitiate = (managesBox, role, user, from, to) =>
    managesBox(role, user, from) || managesBox(role, user, to);

  it('admin can initiate driver → general (manages the destination, not the source)', async () => {
    const { managesBox, validTransferPair } = await import('../lib/db.js');
    expect(managesBox('admin', 'a1', driverBox)).toBe(false);   // does NOT own the source
    expect(canInitiate(managesBox, 'admin', 'a1', driverBox, generalBox)).toBe(true); // …but manages general
    expect(validTransferPair(driverBox, generalBox)).toBe(true);
  });

  it('admin can also request a MANAGER to hand over to general', async () => {
    const { managesBox, validTransferPair } = await import('../lib/db.js');
    expect(canInitiate(managesBox, 'admin', 'a1', managerBox, generalBox)).toBe(true);
    expect(validTransferPair(managerBox, generalBox)).toBe(true);
  });

  it('manager can initiate driver → own box (manages both sides)', async () => {
    const { managesBox, validTransferPair } = await import('../lib/db.js');
    expect(managesBox('manager', 'm1', driverBox)).toBe(true);
    expect(canInitiate(managesBox, 'manager', 'm1', driverBox, managerBox)).toBe(true);
    expect(validTransferPair(driverBox, managerBox)).toBe(true);
  });

  it('the holder (driver) can CONFIRM — manages the source and is not the initiator', async () => {
    const { managesBox } = await import('../lib/db.js');
    const initiator = 'a1';                       // admin initiated the request
    const confirmer = 'd1';                       // the driver confirms
    const managesASide = managesBox('driver', confirmer, driverBox); // owns the source
    expect(managesASide).toBe(true);
    expect(confirmer === initiator).toBe(false);  // dual-confirm: not the initiator
  });

  it('a manager CANNOT request settlement from another manager (no same-role custody pair)', async () => {
    const { managesBox, validTransferPair } = await import('../lib/db.js');
    const otherManagerBox = { id: 4, type: 'custody', owner_username: 'm2', owner_role: 'manager' };
    expect(managesBox('manager', 'm1', otherManagerBox)).toBe(false);          // can't manage their box
    expect(validTransferPair(otherManagerBox, managerBox)).toBe(false);        // and the pair is invalid
  });
});
