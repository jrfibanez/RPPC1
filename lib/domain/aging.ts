// Ticket age and backlog figures. Days are calendar days in Asia/Manila.

export const AGE_BUCKETS = ['0–2 days', '3–7 days', '8–14 days', '15+ days'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const MANILA_OFFSET_MS = 8 * 3_600_000; // The Philippines has no daylight saving time.

/** Whole-day number of an instant on the Manila calendar. */
export const manilaDay = (d: Date) => Math.floor((d.getTime() + MANILA_OFFSET_MS) / 86_400_000);

/** Calendar days since the ticket was created. Created today = 0. */
export const ageInDays = (createdAt: Date, now: Date) => Math.max(0, manilaDay(now) - manilaDay(createdAt));

export function ageBucket(days: number): AgeBucket {
  if (days <= 2) return AGE_BUCKETS[0];
  if (days <= 7) return AGE_BUCKETS[1];
  if (days <= 14) return AGE_BUCKETS[2];
  return AGE_BUCKETS[3];
}

export const isOpenStatus = (status: string) => status !== 'resolved' && status !== 'closed';

/** Overdue = still open and the due time has passed. */
export const isOverdue = (dueAt: Date | null, status: string, now: Date) =>
  !!dueAt && isOpenStatus(status) && dueAt.getTime() < now.getTime();

export type BacklogTicket = {
  status: string; createdAt: Date; dueAt: Date | null;
  owner: string | null; client: string | null; category: string | null;
};

export function summarizeBacklog(tickets: BacklogTicket[], now: Date) {
  const open = tickets.filter((t) => isOpenStatus(t.status));
  const count = (key: (t: BacklogTicket) => string) => {
    const m = new Map<string, number>();
    for (const t of open) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return {
    open: open.length,
    overdue: open.filter((t) => isOverdue(t.dueAt, t.status, now)).length,
    unassigned: open.filter((t) => !t.owner).length,
    byAge: AGE_BUCKETS.map((b) => [b, open.filter((t) => ageBucket(ageInDays(t.createdAt, now)) === b).length] as const),
    byOwner: count((t) => t.owner ?? 'Unassigned'),
    byClient: count((t) => t.client ?? 'No client'),
    byCategory: count((t) => t.category ?? 'Uncategorised'),
  };
}
