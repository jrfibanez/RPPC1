// Business rules enforced by the database: ownership, voiding, attendance, GPS, files, audit.
import { beforeAll, describe, expect, it } from 'vitest';
import { as, categoryId, closeOpenShifts, idOf, makeAccount, ok, service, sql } from './helpers';

const HERE = { in_lat: 14.3306, in_lng: 121.0835 };
const OUT = { out_lat: 14.3306, out_lng: 121.0835 };
let a: Awaited<ReturnType<typeof makeAccount>>;   // account of sales1
let b: Awaited<ReturnType<typeof makeAccount>>;   // account of sales2
beforeAll(async () => { a = await makeAccount('sales1'); b = await makeAccount('sales2'); });

describe('own accounts', () => {
  it('a salesperson cannot see or change another salesperson\'s client, site, contact or ticket', async () => {
    const s2 = await as('sales2');
    for (const [table, id] of [['clients', a.client.id], ['client_sites', a.site.id], ['contacts', a.contact.id], ['tickets', a.ticket.id]] as const) {
      expect((await s2.from(table).select('id').eq('id', id)).data).toHaveLength(0);
      expect((await s2.from(table).update({ name: 'x', subject: 'x' } as never).eq('id', id).select('id')).data ?? []).toHaveLength(0);
    }
    expect((await s2.from('ticket_comments').insert({ ticket_id: a.ticket.id, author_id: await idOf('sales2'), body: 'x' })).error).not.toBeNull();
  });
  it('a salesperson sees a ticket they own even on someone else\'s account', async () => {
    const t = ok(await service.from('tickets').insert({ client_id: a.client.id, channel: 'call', category_id: await categoryId(), subject: 'Handed over', owner_id: await idOf('sales2') }).select('id').single());
    expect((await (await as('sales2')).from('tickets').select('id').eq('id', t.id)).data).toHaveLength(1);
  });
  it('a salesperson cannot create a client for someone else', async () => {
    const res = await (await as('sales1')).from('clients').insert({ name: 'Not mine', account_owner: await idOf('sales2') });
    expect(res.error).not.toBeNull();
  });
  it('search returns only tickets the user may see, including matches in comments', async () => {
    ok(await service.from('ticket_comments').insert({ ticket_id: a.ticket.id, author_id: a.ownerId, body: `note zq${a.token}` }).select('id'));
    expect(ok(await (await as('sales1')).rpc('search_tickets', { q: a.token }))).toHaveLength(1);
    expect(ok(await (await as('sales1')).rpc('search_tickets', { q: `zq${a.token}` }))).toHaveLength(1);
    expect(ok(await (await as('sales2')).rpc('search_tickets', { q: a.token }))).toHaveLength(0);
    expect(ok(await (await as('driver')).rpc('search_tickets', { q: a.token }))).toHaveLength(0);
  });
});

describe('accreditation', () => {
  it('sales can move prospect ↔ verified but cannot accredit; finance can', async () => {
    const s1 = await as('sales1');
    expect(ok(await s1.from('clients').update({ accreditation_status: 'verified' }).eq('id', a.client.id).select('id'))).toHaveLength(1);
    expect((await s1.from('clients').update({ accreditation_status: 'accredited' }).eq('id', a.client.id).select()).error?.message).toMatch(/Only Admin or Finance/);
    const fin = await as('finance');
    expect(ok(await fin.from('clients').update({ accreditation_status: 'accredited' }).eq('id', a.client.id).select('is_accredited'))[0].is_accredited).toBe(true);
    expect((await s1.from('clients').update({ accreditation_status: 'prospect' }).eq('id', a.client.id).select()).error).not.toBeNull();
    expect((await fin.from('clients').update({ name: 'Renamed by finance' }).eq('id', a.client.id).select()).error?.message).toMatch(/only change the accreditation/);
  });
});

describe('tickets', () => {
  it('status and owner changes are written into the thread', async () => {
    ok(await (await as('sales1')).from('tickets').update({ status: 'in_progress' }).eq('id', a.ticket.id).select('id'));
    const thread = ok(await service.from('ticket_comments').select('kind, body').eq('ticket_id', a.ticket.id).eq('kind', 'system'));
    expect(thread.some((c) => c.body.includes('Status: open → in progress'))).toBe(true);
  });
  it('comments cannot be edited, faked as another author, or posted as system', async () => {
    const s1 = await as('sales1');
    const c = ok(await s1.from('ticket_comments').insert({ ticket_id: a.ticket.id, author_id: a.ownerId, body: 'Original' }).select('id').single());
    for (const who of ['sales1', 'admin'] as const) await (await as(who)).from('ticket_comments').update({ body: 'Edited' }).eq('id', c.id);
    expect(ok(await service.from('ticket_comments').select('body').eq('id', c.id).single()).body).toBe('Original');
    expect((await s1.from('ticket_comments').insert({ ticket_id: a.ticket.id, author_id: await idOf('admin'), body: 'x' })).error).not.toBeNull();
    expect((await s1.from('ticket_comments').insert({ ticket_id: a.ticket.id, author_id: a.ownerId, kind: 'system', body: 'x' })).error).not.toBeNull();
  });
  it('a site from another client is refused', async () => {
    const res = await (await as('admin')).from('tickets').insert({ client_id: a.client.id, site_id: b.site.id, channel: 'call', category_id: await categoryId(), subject: 'Wrong site' });
    expect(res.error?.message).toMatch(/does not belong/);
  });
  it('void: needs the permission and a reason; a voided ticket is frozen and kept', async () => {
    const t = ok(await service.from('tickets').insert({ client_id: a.client.id, channel: 'call', category_id: await categoryId(), subject: 'To void', owner_id: a.ownerId }).select('id').single());
    const now = new Date().toISOString();
    expect((await (await as('sales1')).from('tickets').update({ voided_at: now, void_reason: 'x' }).eq('id', t.id).select()).error?.message).toMatch(/not allowed to void/);
    const ops = await as('deployment_officer');
    expect((await ops.from('tickets').update({ voided_at: now, void_reason: '  ' }).eq('id', t.id).select()).error).not.toBeNull();
    expect(ok(await ops.from('tickets').update({ voided_at: now, void_reason: 'Duplicate' }).eq('id', t.id).select('voided_by'))[0].voided_by).toBe(await idOf('deployment_officer'));
    expect((await ops.from('tickets').update({ status: 'closed' }).eq('id', t.id).select()).error?.message).toMatch(/voided ticket cannot be changed/);
    expect((await ops.from('ticket_comments').insert({ ticket_id: t.id, author_id: await idOf('deployment_officer'), body: 'late' })).error).not.toBeNull();
    expect(ok(await service.from('tickets').select('id').eq('id', t.id))).toHaveLength(1);
  });
  it('attachment files follow the ticket: only people who can see the ticket can open them', async () => {
    const path = `${a.ticket.id}/proof-${a.token}.png`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    expect((await (await as('sales1')).storage.from('ticket-attachments').upload(path, png, { contentType: 'image/png' })).error).toBeNull();
    expect((await (await as('sales1')).storage.from('ticket-attachments').download(path)).error).toBeNull();
    for (const who of ['sales2', 'driver'] as const) {
      const c = await as(who);
      expect((await c.storage.from('ticket-attachments').download(path)).error).not.toBeNull();
      expect((await c.storage.from('ticket-attachments').upload(`${a.ticket.id}/intruder-${who}.png`, png, { contentType: 'image/png' })).error).not.toBeNull();
    }
  });
});

describe('clock in / clock out', () => {
  it('location is required to clock in and to clock out', async () => {
    const s1 = await as('sales1'); const me = await idOf('sales1');
    await closeOpenShifts(me);
    expect((await s1.from('attendance_logs').insert({ user_id: me, clock_in_at: new Date().toISOString() })).error?.message).toMatch(/attendance_in_gps_required/);
    const shift = ok(await s1.from('attendance_logs').insert({ user_id: me, clock_in_at: new Date().toISOString(), ...HERE }).select('id').single());
    expect((await s1.from('attendance_logs').update({ clock_out_at: new Date().toISOString() }).eq('id', shift.id).select()).error?.message).toMatch(/Location is required to clock out/);
    expect(ok(await s1.from('attendance_logs').update({ clock_out_at: new Date().toISOString(), ...OUT }).eq('id', shift.id).select('id'))).toHaveLength(1);
  });
  it('one open shift per person; clock-in details cannot be changed; a closed shift is final', async () => {
    const s1 = await as('sales1'); const me = await idOf('sales1');
    await closeOpenShifts(me);
    const shift = ok(await s1.from('attendance_logs').insert({ user_id: me, clock_in_at: new Date().toISOString(), ...HERE }).select('id').single());
    expect((await s1.from('attendance_logs').insert({ user_id: me, clock_in_at: new Date().toISOString(), ...HERE })).error?.code).toBe('23505');
    expect((await s1.from('attendance_logs').update({ clock_in_at: '2026-01-01T00:00:00Z', clock_out_at: new Date().toISOString(), ...OUT }).eq('id', shift.id).select()).error?.message).toMatch(/cannot be changed/);
    ok(await s1.from('attendance_logs').update({ clock_out_at: new Date().toISOString(), ...OUT }).eq('id', shift.id).select('id'));
    expect((await s1.from('attendance_logs').update({ clock_out_at: new Date().toISOString(), ...OUT }).eq('id', shift.id).select()).error?.message).toMatch(/already closed/);
  });
  it('nobody can clock in for someone else; others cannot see it; admin sees it and closes it only with a reason', async () => {
    const s1 = await as('sales1'); const me = await idOf('sales1');
    await closeOpenShifts(me);
    expect((await (await as('sales2')).from('attendance_logs').insert({ user_id: me, clock_in_at: new Date().toISOString(), ...HERE })).error).not.toBeNull();
    const shift = ok(await s1.from('attendance_logs').insert({ user_id: me, clock_in_at: new Date().toISOString(), ...HERE }).select('id').single());
    expect((await (await as('sales2')).from('attendance_logs').select('id').eq('id', shift.id)).data).toHaveLength(0);
    const admin = await as('admin');
    expect((await admin.from('attendance_logs').select('id').eq('id', shift.id)).data).toHaveLength(1);
    expect((await admin.from('attendance_logs').update({ clock_out_at: new Date().toISOString() }).eq('id', shift.id).select()).error?.message).toMatch(/reason is required/);
    const closed = ok(await admin.from('attendance_logs').update({ clock_out_at: new Date().toISOString(), close_reason: 'Forgot to clock out' }).eq('id', shift.id).select('closed_by'));
    expect(closed[0].closed_by).toBe(await idOf('admin'));
  });
});

describe('client visits', () => {
  const visit = async (userKey: 'sales1' | 'sales2', clientId: string, extra: Record<string, unknown> = { lat: 14.28, lng: 121.12 }) => {
    const uid = await idOf(userKey); const id = crypto.randomUUID();
    return { id, uid, row: { id, user_id: uid, client_id: clientId, purpose: 'Visit', photo_path: `${uid}/${id}.jpg`, captured_at: new Date().toISOString(), ...extra } };
  };
  it('location is required', async () => {
    const v = await visit('sales1', a.client.id, {});
    expect((await (await as('sales1')).from('client_visits').insert(v.row)).error?.message).toMatch(/client_visits_gps_required/);
  });
  it('only for a client the user can see, and the photo path must be the user\'s own', async () => {
    const s1 = await as('sales1');
    expect((await s1.from('client_visits').insert((await visit('sales1', b.client.id)).row)).error).not.toBeNull();
    const v = await visit('sales1', a.client.id);
    expect((await s1.from('client_visits').insert({ ...v.row, photo_path: `${await idOf('sales2')}/${v.id}.jpg` })).error).not.toBeNull();
    expect((await s1.from('client_visits').insert(v.row)).error).toBeNull();
  });
  it('the selfie can be opened by its owner and admin only', async () => {
    const v = await visit('sales1', a.client.id);
    const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
    const s1 = await as('sales1');
    expect((await s1.storage.from('visit-photos').upload(v.row.photo_path, jpg, { contentType: 'image/jpeg' })).error).toBeNull();
    expect((await (await as('sales2')).storage.from('visit-photos').upload(`${v.uid}/${crypto.randomUUID()}.jpg`, jpg, { contentType: 'image/jpeg' })).error).not.toBeNull();
    expect((await s1.storage.from('visit-photos').download(v.row.photo_path)).error).toBeNull();
    expect((await (await as('admin')).storage.from('visit-photos').download(v.row.photo_path)).error).toBeNull();
    for (const who of ['sales2', 'finance', 'driver'] as const) expect((await (await as(who)).storage.from('visit-photos').download(v.row.photo_path)).error).not.toBeNull();
  });
});

describe('permissions and accounts', () => {
  it('a permission change takes effect at once, without redeploying', async () => {
    const admin = await as('admin'); const fin = await as('finance');
    expect((await fin.from('tickets').select('id').eq('id', a.ticket.id)).data).toHaveLength(1);
    ok(await admin.from('role_permissions').delete().eq('role', 'finance').eq('permission', 'tickets.read_all').select());
    try {
      expect((await fin.from('tickets').select('id').eq('id', a.ticket.id)).data).toHaveLength(0);
    } finally {
      ok(await admin.from('role_permissions').insert({ role: 'finance', permission: 'tickets.read_all' }).select());
    }
    expect((await fin.from('tickets').select('id').eq('id', a.ticket.id)).data).toHaveLength(1);
  });
  it('admin cannot remove its own key permissions, demote itself or turn itself off', async () => {
    const admin = await as('admin');
    expect((await admin.from('role_permissions').delete().eq('role', 'admin').eq('permission', 'admin.users').select()).error?.message).toMatch(/cannot lose/);
    expect((await admin.from('profiles').update({ is_active: false }).eq('id', await idOf('admin')).select()).error?.message).toMatch(/cannot change your own/);
    expect((await admin.from('profiles').update({ role: 'sales' }).eq('id', await idOf('admin')).select()).error).not.toBeNull();
  });
  it('a turned-off account can read nothing, even with a live session', async () => {
    const wh = await as('warehouse'); const id = await idOf('warehouse');
    expect((await wh.from('profiles').select('id').limit(1)).data).toHaveLength(1);
    ok(await service.from('profiles').update({ is_active: false }).eq('id', id).select('id'));
    try {
      expect((await wh.from('profiles').select('id').limit(1)).data).toHaveLength(0);
      expect((await wh.from('role_permissions').select('role')).data).toHaveLength(0);
    } finally {
      ok(await service.from('profiles').update({ is_active: true }).eq('id', id).select('id'));
    }
  });
});

describe('audit log and structure', () => {
  it('records who changed what, with before and after', async () => {
    ok(await (await as('sales1')).from('clients').update({ tin: `TIN-${a.token}` }).eq('id', a.client.id).select('id'));
    const rows = ok(await service.from('audit_log').select('*').eq('table_name', 'clients').eq('row_id', a.client.id).eq('action', 'UPDATE').order('id', { ascending: false }).limit(1));
    expect(rows[0].actor_id).toBe(a.ownerId);
    expect(rows[0].new_row.tin).toBe(`TIN-${a.token}`);
    expect(rows[0].old_row.tin).not.toBe(`TIN-${a.token}`);
  });
  it('cannot be changed or emptied, even with the master key or as the database owner', async () => {
    expect((await service.from('audit_log').update({ action: 'x' }).gt('id', 0).select()).error).not.toBeNull();
    expect((await service.from('audit_log').delete().gt('id', 0).select()).error).not.toBeNull();
    for (const q of ["update public.audit_log set action = 'x'", 'delete from public.audit_log', 'truncate public.audit_log']) {
      await expect(sql.query(q)).rejects.toThrow(/append-only/);
    }
  });
  it('every public table has row security on, an audit trigger, and no access for the public key', async () => {
    const { rows } = await sql.query(`
      select c.relname as t, c.relrowsecurity as rls,
        exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid where g.tgrelid = c.oid and p.proname = 'audit_row') as audited,
        has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') as anon_access,
        has_table_privilege('authenticated', c.oid, 'delete') as can_delete
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
    expect(rows.length).toBeGreaterThanOrEqual(14);
    const system = ['audit_log', 'doc_sequences', 'code_sequences'];
    for (const r of rows) {
      expect(r.rls, `${r.t} row security`).toBe(true);
      expect(r.anon_access, `${r.t} public-key access`).toBe(false);
      if (!system.includes(r.t)) expect(r.audited, `${r.t} audit trigger`).toBe(true);
      if (r.t !== 'role_permissions') expect(r.can_delete, `${r.t} delete right`).toBe(false);
    }
  });
});
