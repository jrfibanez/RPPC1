import { describe, expect, it } from 'vitest';
import { ageBucket, ageInDays, isOverdue, summarizeBacklog } from '@/lib/domain/aging';

const d = (s: string) => new Date(s);

describe('ticket age', () => {
  it('counts calendar days in Manila, not 24-hour blocks', () => {
    // 23:30 on Nov 10 Manila → 00:30 on Nov 11 Manila is one day later.
    expect(ageInDays(d('2026-11-10T15:30:00Z'), d('2026-11-10T16:30:00Z'))).toBe(1);
    // Same Manila day, 20 hours apart.
    expect(ageInDays(d('2026-11-10T16:30:00Z'), d('2026-11-11T12:30:00Z'))).toBe(0);
    expect(ageInDays(d('2026-11-01T02:00:00Z'), d('2026-11-16T02:00:00Z'))).toBe(15);
  });
  it('never returns a negative age', () => {
    expect(ageInDays(d('2026-11-12T00:00:00Z'), d('2026-11-10T00:00:00Z'))).toBe(0);
  });
  it('puts ages into the four buckets at the right edges', () => {
    expect([0, 2, 3, 7, 8, 14, 15, 90].map(ageBucket)).toEqual(
      ['0–2 days', '0–2 days', '3–7 days', '3–7 days', '8–14 days', '8–14 days', '15+ days', '15+ days']);
  });
});

describe('overdue', () => {
  const now = d('2026-11-12T04:00:00Z');
  it('is true only for open tickets past their due time', () => {
    expect(isOverdue(d('2026-11-12T03:59:00Z'), 'open', now)).toBe(true);
    expect(isOverdue(d('2026-11-12T04:01:00Z'), 'open', now)).toBe(false);
    expect(isOverdue(d('2026-11-01T00:00:00Z'), 'resolved', now)).toBe(false);
    expect(isOverdue(d('2026-11-01T00:00:00Z'), 'closed', now)).toBe(false);
    expect(isOverdue(null, 'open', now)).toBe(false);
  });
});

describe('backlog summary', () => {
  const now = d('2026-11-12T04:00:00Z');
  const t = (o: Partial<Parameters<typeof summarizeBacklog>[0][number]>) =>
    ({ status: 'open', createdAt: now, dueAt: null, owner: 'Sam', client: 'A', category: 'Billing', ...o });
  it('counts only open tickets and groups them', () => {
    const s = summarizeBacklog([
      t({}), t({ createdAt: d('2026-11-07T04:00:00Z'), owner: null, dueAt: d('2026-11-08T00:00:00Z') }),
      t({ createdAt: d('2026-10-01T00:00:00Z'), client: 'B', status: 'in_progress' }),
      t({ status: 'closed', dueAt: d('2026-01-01T00:00:00Z') }),
    ], now);
    expect(s.open).toBe(3);
    expect(s.overdue).toBe(1);
    expect(s.unassigned).toBe(1);
    expect(s.byAge.map(([, n]) => n)).toEqual([1, 1, 0, 1]);
    expect(s.byOwner).toEqual([['Sam', 2], ['Unassigned', 1]]);
    expect(s.byClient).toEqual([['A', 2], ['B', 1]]);
  });
});
