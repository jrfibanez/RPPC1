// One test per role per table: what each role can read, insert, update and delete.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ROLES, type Role, anon, as, categoryId, closeOpenShifts, idOf, makeAccount, ok, service, tag, userFor } from './helpers';

type Ctx = { uid: string; fx: Awaited<ReturnType<typeof build>> };
type Spec = {
  table: string;
  fixtureId: (fx: Ctx['fx']) => string;
  read: Role[];
  insert: Role[];
  update: Role[];
  /** null = this table has its own update tests in rules.test.ts */
  patch: Record<string, unknown> | null;
  row: (c: Ctx) => Record<string, unknown> | Promise<Record<string, unknown>>;
  beforeInsert?: (c: Ctx) => Promise<void>;
};

const TICKET_ROLES: Role[] = ['admin', 'sales', 'deployment_officer', 'finance'];
const CLIENT_WRITERS: Role[] = ['admin', 'sales'];
const FIELD_READERS: Role[] = ['admin', 'sales'];

async function build() {
  const acct = await makeAccount('sales1');
  const comment = ok(await service.from('ticket_comments').insert({ ticket_id: acct.ticket.id, author_id: acct.ownerId, body: 'Fixture comment' }).select().single());
  const attachment = ok(await service.from('ticket_attachments').insert({
    ticket_id: acct.ticket.id, storage_path: `${acct.ticket.id}/${tag()}-a.png`, file_name: 'a.png',
    mime_type: 'image/png', size_bytes: 10, uploaded_by: acct.ownerId,
  }).select().single());
  const shift = ok(await service.from('attendance_logs').insert({
    user_id: acct.ownerId, clock_in_at: '2026-01-05T00:00:00Z', clock_out_at: '2026-01-05T09:00:00Z',
  }).select().single());
  const visitId = crypto.randomUUID();
  const visit = ok(await service.from('client_visits').insert({
    id: visitId, user_id: acct.ownerId, client_id: acct.client.id, purpose: 'Fixture',
    photo_path: `${acct.ownerId}/${visitId}.jpg`, captured_at: '2026-01-05T02:00:00Z',
  }).select().single());
  const category = ok(await service.from('ticket_categories').insert({ name: `Cat ${tag()}` }).select().single());
  return { ...acct, comment, attachment, shift, visit, category };
}

const SPECS: Spec[] = [
  {
    table: 'clients', fixtureId: (f) => f.client.id, read: TICKET_ROLES, insert: CLIENT_WRITERS, update: CLIENT_WRITERS,
    patch: { trade_name: 'Changed' }, row: ({ uid }) => ({ name: `Matrix ${tag()}`, account_owner: uid }),
  },
  {
    table: 'client_sites', fixtureId: (f) => f.site.id, read: TICKET_ROLES, insert: CLIENT_WRITERS, update: CLIENT_WRITERS,
    patch: { address: 'Changed' }, row: ({ fx }) => ({ client_id: fx.client.id, name: `Site ${tag()}` }),
  },
  {
    table: 'contacts', fixtureId: (f) => f.contact.id, read: TICKET_ROLES, insert: CLIENT_WRITERS, update: CLIENT_WRITERS,
    patch: { position: 'Changed' }, row: ({ fx }) => ({ client_id: fx.client.id, name: `Contact ${tag()}` }),
  },
  {
    table: 'ticket_categories', fixtureId: (f) => f.category.id, read: TICKET_ROLES, insert: ['admin'], update: ['admin'],
    patch: { sort_order: 55 }, row: () => ({ name: `Cat ${tag()}` }),
  },
  {
    table: 'tickets', fixtureId: (f) => f.ticket.id, read: TICKET_ROLES, insert: TICKET_ROLES, update: TICKET_ROLES,
    patch: { description: 'Changed' },
    row: async ({ fx, uid }) => ({ client_id: fx.client.id, channel: 'call', category_id: await categoryId(), subject: `Matrix ${tag()}`, owner_id: uid }),
  },
  {
    table: 'ticket_comments', fixtureId: (f) => f.comment.id, read: TICKET_ROLES, insert: TICKET_ROLES, update: [],
    patch: { body: 'Edited' }, row: ({ fx, uid }) => ({ ticket_id: fx.ticket.id, author_id: uid, body: 'Matrix comment' }),
  },
  {
    table: 'ticket_attachments', fixtureId: (f) => f.attachment.id, read: TICKET_ROLES, insert: TICKET_ROLES, update: [],
    patch: { file_name: 'x.png' },
    row: ({ fx, uid }) => ({ ticket_id: fx.ticket.id, storage_path: `${fx.ticket.id}/${tag()}.png`, file_name: 'm.png', mime_type: 'image/png', size_bytes: 5, uploaded_by: uid }),
  },
  {
    table: 'attendance_logs', fixtureId: (f) => f.shift.id, read: FIELD_READERS, insert: ['sales'], update: [],
    patch: null, row: ({ uid }) => ({ user_id: uid, clock_in_at: new Date().toISOString() }),
    beforeInsert: ({ uid }) => closeOpenShifts(uid),
  },
  {
    table: 'client_visits', fixtureId: (f) => f.visit.id, read: FIELD_READERS, insert: ['sales'], update: [],
    patch: { notes: 'Edited' },
    row: ({ fx, uid }) => { const id = crypto.randomUUID(); return { id, user_id: uid, client_id: fx.client.id, purpose: 'Matrix', photo_path: `${uid}/${id}.jpg`, captured_at: new Date().toISOString() }; },
  },
];

const denied = (error: { code?: string; message: string } | null) =>
  !!error && (error.code === '42501' || /permission denied|row-level security/i.test(error.message));

let fx: Awaited<ReturnType<typeof build>>;
beforeAll(async () => { fx = await build(); });

describe.each(SPECS)('$table', (spec) => {
  describe.each(ROLES.map((role) => ({ role })))('as $role', ({ role }) => {
    let client: SupabaseClient; let uid: string;
    beforeAll(async () => { client = await as(userFor(role)); uid = await idOf(userFor(role)); });

    it(`${spec.read.includes(role) ? 'can' : 'cannot'} read`, async () => {
      const { data } = await client.from(spec.table).select('id').eq('id', spec.fixtureId(fx));
      expect(data ?? []).toHaveLength(spec.read.includes(role) ? 1 : 0);
    });

    it(`${spec.insert.includes(role) ? 'can' : 'cannot'} insert`, async () => {
      await spec.beforeInsert?.({ uid, fx });
      const { error } = await client.from(spec.table).insert(await spec.row({ uid, fx }));
      if (spec.insert.includes(role)) expect(error).toBeNull();
      else expect(denied(error)).toBe(true);
    });

    if (spec.patch) {
      it(`${spec.update.includes(role) ? 'can' : 'cannot'} update`, async () => {
        // Each role writes a different value, so a refused change can never look like a no-op.
        const patch = Object.fromEntries(Object.entries(spec.patch!).map(([k, v]) => [k, typeof v === 'string' ? `${v} by ${role}` : v]));
        const { data } = await client.from(spec.table).update(patch).eq('id', spec.fixtureId(fx)).select('id');
        expect(data ?? []).toHaveLength(spec.update.includes(role) ? 1 : 0);
      });
    }

    it('cannot delete', async () => {
      await client.from(spec.table).delete().eq('id', spec.fixtureId(fx));
      const still = ok(await service.from(spec.table).select('id').eq('id', spec.fixtureId(fx)));
      expect(still).toHaveLength(1);
    });
  });
});

describe('system tables', () => {
  describe.each(ROLES.map((role) => ({ role })))('as $role', ({ role }) => {
    let client: SupabaseClient;
    beforeAll(async () => { client = await as(userFor(role)); });

    it('profiles: can read names; only admin can add or change users', async () => {
      const { data } = await client.from('profiles').select('id').eq('id', fx.ownerId);
      expect(data ?? []).toHaveLength(1);
      // A made-up id: admin passes the security rule and stops at "no such login"; others are refused.
      const ins = await client.from('profiles').insert({ id: crypto.randomUUID(), full_name: 'X', login_email: 'x@x', role: 'admin' });
      expect(denied(ins.error)).toBe(role !== 'admin');
      expect(ins.error).not.toBeNull();
      const upd = await client.from('profiles').update({ full_name: 'Sara Sales' }).eq('id', await idOf('sales2')).select('id');
      expect(upd.data ?? []).toHaveLength(role === 'admin' ? 1 : 0);
      await client.from('profiles').delete().eq('id', await idOf('sales2'));
      expect(ok(await service.from('profiles').select('id').eq('id', await idOf('sales2')))).toHaveLength(1);
    });

    it('role_permissions: sees only its own role unless admin; only admin can change', async () => {
      const rows = ok(await client.from('role_permissions').select('role'));
      const roles = new Set(rows.map((r) => r.role));
      if (role === 'admin') expect(roles.size).toBeGreaterThan(1);
      else expect([...roles].every((r) => r === role)).toBe(true);
      const perm = `test.${tag()}`;
      const ins = await client.from('role_permissions').insert({ role: 'warehouse', permission: perm });
      expect(ins.error === null).toBe(role === 'admin');
      const del = await client.from('role_permissions').delete().eq('permission', 'field.use').eq('role', 'sales').select();
      if (role !== 'admin') expect(del.data ?? []).toHaveLength(0);
      await service.from('role_permissions').upsert({ role: 'sales', permission: 'field.use' });
      await service.from('role_permissions').delete().eq('permission', perm);
    });

    it('audit_log: only admin can read; nobody can write', async () => {
      const { data } = await client.from('audit_log').select('id').limit(1);
      expect(data ?? []).toHaveLength(role === 'admin' ? 1 : 0);
      expect((await client.from('audit_log').insert({ table_name: 'x', action: 'INSERT' })).error).not.toBeNull();
      expect((await client.from('audit_log').update({ action: 'x' }).gt('id', 0).select()).error).not.toBeNull();
      expect((await client.from('audit_log').delete().gt('id', 0).select()).error).not.toBeNull();
    });

    it('number counters: no access', async () => {
      for (const t of ['doc_sequences', 'code_sequences']) {
        expect((await client.from(t).select('*')).data ?? []).toHaveLength(0);
        expect((await client.from(t).insert(t === 'doc_sequences' ? { series: 'X', year: 2026 } : { scope: 'x' })).error).not.toBeNull();
      }
    });
  });
});

describe('not signed in', () => {
  it.each(['profiles', 'role_permissions', 'audit_log', 'doc_sequences', 'code_sequences', 'clients', 'client_sites',
    'contacts', 'ticket_categories', 'tickets', 'ticket_comments', 'ticket_attachments', 'attendance_logs',
    'client_visits'])('%s is closed to the public key', async (table) => {
    const { data, error } = await anon.from(table).select('*').limit(1);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
