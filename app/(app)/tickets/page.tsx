import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { Badge, PageHeader, fmtDate, pretty } from '@/components/ui';
import { AGE_BUCKETS, ageBucket, ageInDays, isOpenStatus, isOverdue } from '@/lib/domain/aging';
import { STATUSES } from '@/lib/validation/schemas';

const COLS = 'id, code, subject, status, channel, created_at, due_at, voided_at, owner_id, client:clients(name), category:ticket_categories(name), owner:profiles!tickets_owner_id_fkey(full_name)';
type Row = { id: string; code: string; subject: string; status: string; channel: string; created_at: string; due_at: string | null;
  voided_at: string | null; owner_id: string | null; client: { name: string } | { name: string }[] | null;
  category: { name: string } | { name: string }[] | null; owner: { full_name: string } | { full_name: string }[] | null };
const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

export default async function TicketsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; view?: string; status?: string; age?: string }>;
}) {
  const { q = '', view = 'open', status = '', age = '' } = await searchParams;
  const { supabase, user } = await getSession();
  const base = q.trim()
    ? supabase.rpc('search_tickets', { q: q.trim() }).select(COLS)
    : supabase.from('tickets').select(COLS).order('created_at', { ascending: false });
  const { data } = await base.limit(1000);
  const now = new Date();
  const rows = ((data ?? []) as unknown as Row[]).filter((t) => {
    if (view === 'voided') return !!t.voided_at;
    if (t.voided_at) return false;
    if (status && t.status !== status) return false;
    if (view === 'open' && !isOpenStatus(t.status)) return false;
    if (view === 'mine' && (t.owner_id !== user.id || !isOpenStatus(t.status))) return false;
    if (view === 'unassigned' && (t.owner_id || !isOpenStatus(t.status))) return false;
    if (view === 'overdue' && !isOverdue(t.due_at ? new Date(t.due_at) : null, t.status, now)) return false;
    if (age !== '' && ageBucket(ageInDays(new Date(t.created_at), now)) !== AGE_BUCKETS[Number(age)]) return false;
    return true;
  });
  const views = [['open', 'Open'], ['mine', 'Mine'], ['overdue', 'Overdue'], ['unassigned', 'No owner'], ['all', 'All'], ['voided', 'Voided']];

  return (
    <>
      <PageHeader title="Tickets" action={{ href: '/tickets/new', label: 'New ticket' }} />
      <div className="mb-3 flex flex-wrap gap-2">
        {views.map(([v, label]) => (
          <Link key={v} href={`/tickets?view=${v}`} className={`rounded-full px-3 py-1 text-sm font-semibold ${view === v && !q ? 'bg-brand text-white' : 'bg-white text-ink border border-stone-300'}`}>{label}</Link>
        ))}
      </div>
      <form className="mb-3 flex flex-wrap gap-2">
        <input type="hidden" name="view" value={q ? 'all' : view} />
        <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Search code, subject, comments, client, site" />
        <select className="input max-w-[12rem]" name="status" defaultValue={status}>
          <option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
        </select>
        <button className="btn-light">Search</button>
        {(q || status || age) && <Link className="btn-light" href="/tickets">Clear</Link>}
      </form>
      <p className="mb-2 text-sm text-stone-500">{rows.length} ticket{rows.length === 1 ? '' : 's'}{age !== '' ? ` · age ${AGE_BUCKETS[Number(age)]}` : ''}</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-stone-200"><tr>
            <th className="th">Code</th><th className="th">Subject</th><th className="th">Client</th><th className="th">Status</th>
            <th className="th">Owner</th><th className="th">Age</th><th className="th">Due</th>
          </tr></thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((t) => {
              const overdue = isOverdue(t.due_at ? new Date(t.due_at) : null, t.status, now) && !t.voided_at;
              return (
                <tr key={t.id} className="hover:bg-stone-50">
                  <td className="td whitespace-nowrap font-mono">{t.code}</td>
                  <td className="td"><Link className="font-semibold text-brand hover:underline" href={`/tickets/${t.id}`}>{t.subject}</Link>
                    <div className="text-xs text-stone-500">{one(t.category)?.name} · via {pretty(t.channel)}</div></td>
                  <td className="td">{one(t.client)?.name ?? '—'}</td>
                  <td className="td whitespace-nowrap">{t.voided_at ? <span className="badge bg-stone-800 text-white">Voided</span> : <Badge value={t.status} />}</td>
                  <td className="td">{one(t.owner)?.full_name ?? <span className="text-brand">No owner</span>}</td>
                  <td className="td whitespace-nowrap">{ageInDays(new Date(t.created_at), now)} d</td>
                  <td className={`td whitespace-nowrap ${overdue ? 'font-semibold text-brand' : ''}`}>{fmtDate(t.due_at)}{overdue ? ' · overdue' : ''}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td className="td text-stone-500" colSpan={7}>No tickets found.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
