import { describe, expect, it } from 'vitest';
import { as, categoryId, idOf, makeAccount, ok, service, sql } from './helpers';

const seqNo = (code: string) => Number(code.split('-')[2]);

describe('document numbering', () => {
  it('formats PREFIX-YYYY-NNNNN and counts up per series', async () => {
    const c = await sql.connect();
    try {
      await c.query('begin');
      const next = async (s: string, at: string) =>
        (await c.query('select public.next_doc_code($1, $2::timestamptz) as code', [s, at])).rows[0].code;
      expect(await next('ZZT', '2026-06-01T10:00:00+08')).toBe('ZZT-2026-00001');
      expect(await next('ZZT', '2026-06-02T10:00:00+08')).toBe('ZZT-2026-00002');
      expect(await next('ZZU', '2026-06-02T10:00:00+08')).toBe('ZZU-2026-00001');
    } finally { await c.query('rollback'); c.release(); }
  });

  it('starts again at 00001 in a new year, using Manila time', async () => {
    const c = await sql.connect();
    try {
      await c.query('begin');
      const next = async (at: string) =>
        (await c.query("select public.next_doc_code('ZZT', $1::timestamptz) as code", [at])).rows[0].code;
      expect(await next('2026-12-31T15:59:00Z')).toBe('ZZT-2026-00001'); // 23:59 Dec 31 in Manila
      expect(await next('2026-12-31T16:00:00Z')).toBe('ZZT-2027-00001'); // 00:00 Jan 1 in Manila
      expect(await next('2026-12-31T16:05:00Z')).toBe('ZZT-2027-00002');
    } finally { await c.query('rollback'); c.release(); }
  });

  it('gives unique, gap-free codes to 25 tickets created at the same moment', async () => {
    const admin = await as('admin');
    const cat = await categoryId();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) =>
      admin.from('tickets').insert({ channel: 'call', category_id: cat, subject: `Concurrent ${i}` }).select('code').single()));
    const nos = results.map((r) => seqNo(ok(r).code)).sort((a, b) => a - b);
    expect(new Set(nos).size).toBe(25);
    expect(nos[24] - nos[0]).toBe(24);
  });

  it('does not use up a number when the insert fails', async () => {
    const admin = await as('admin');
    const cat = await categoryId();
    const before = seqNo(ok(await admin.from('tickets').insert({ channel: 'call', category_id: cat, subject: 'Before' }).select('code').single()).code);
    const bad = await admin.from('tickets').insert({ channel: 'call', category_id: cat, subject: '   ' }).select('code');
    expect(bad.error).not.toBeNull();
    const after = seqNo(ok(await admin.from('tickets').insert({ channel: 'call', category_id: cat, subject: 'After' }).select('code').single()).code);
    expect(after).toBe(before + 1);
  });

  it('never reuses the code of a voided ticket', async () => {
    const admin = await as('admin');
    const cat = await categoryId();
    const first = ok(await admin.from('tickets').insert({ channel: 'call', category_id: cat, subject: 'To void' }).select('id, code').single());
    ok(await admin.from('tickets').update({ voided_at: new Date().toISOString(), void_reason: 'Duplicate entry' }).eq('id', first.id).select('id'));
    const second = ok(await admin.from('tickets').insert({ channel: 'call', category_id: cat, subject: 'Next' }).select('code').single());
    expect(seqNo(second.code)).toBe(seqNo(first.code) + 1);
    const still = ok(await service.from('tickets').select('code, voided_at').eq('id', first.id).single());
    expect(still.code).toBe(first.code);
    expect(still.voided_at).not.toBeNull();
  });

  it('ignores a code supplied by the user and refuses to change one', async () => {
    const admin = await as('admin');
    const row = ok(await admin.from('tickets').insert({ code: 'TKT-2026-99999', channel: 'call', category_id: await categoryId(), subject: 'Own code' }).select('id, code').single());
    expect(row.code).not.toBe('TKT-2026-99999');
    expect(row.code).toMatch(/^TKT-\d{4}-\d{5}$/);
    const change = await admin.from('tickets').update({ code: 'TKT-2026-00001' }).eq('id', row.id).select();
    expect(change.error?.message).toMatch(/cannot be changed/);
  });

  it('does not let users call the numbering functions directly', async () => {
    for (const key of ['admin', 'sales1'] as const) {
      const c = await as(key);
      expect((await c.rpc('next_doc_code', { p_series: 'TKT' })).error).not.toBeNull();
      expect((await c.rpc('next_master_no', { p_scope: 'client' })).error).not.toBeNull();
      expect((await c.from('doc_sequences').select('*')).data ?? []).toHaveLength(0);
    }
  });

  it('numbers clients CL-0001 and sites CL-0001-S01 within the client', async () => {
    const sales = await as('sales1');
    const me = await idOf('sales1');
    const client = ok(await sales.from('clients').insert({ name: 'Numbering Test Co', account_owner: me }).select('id, code').single());
    expect(client.code).toMatch(/^CL-\d{4}$/);
    const s1 = ok(await sales.from('client_sites').insert({ client_id: client.id, name: 'First' }).select('code').single());
    const s2 = ok(await sales.from('client_sites').insert({ client_id: client.id, name: 'Second' }).select('code').single());
    expect(s1.code).toBe(`${client.code}-S01`);
    expect(s2.code).toBe(`${client.code}-S02`);
    const other = await makeAccount('sales2');
    expect(other.site.code).toBe(`${other.client.code}-S01`);
  });
});
