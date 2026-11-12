import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { summarizeBacklog } from '@/lib/domain/aging';

export default async function Dashboard() {
  const { supabase, user, can } = await getSession();
  if (!can('tickets.read_all') && !can('tickets.read_own')) {
    if (can('field.use')) redirect('/field');
    return (
      <div className="card max-w-xl">
        <h1 className="h1">Welcome, {user.name}</h1>
        <p className="mt-2 text-stone-600">Your screens are part of a later phase. There is nothing for your role to do here yet.</p>
      </div>
    );
  }

  const { data } = await supabase.from('tickets')
    .select('status, created_at, due_at, owner:profiles!tickets_owner_id_fkey(full_name), client:clients(name), category:ticket_categories(name)')
    .is('voided_at', null).not('status', 'in', '(resolved,closed)').limit(5000);
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);
  const s = summarizeBacklog((data ?? []).map((t) => ({
    status: t.status, createdAt: new Date(t.created_at), dueAt: t.due_at ? new Date(t.due_at) : null,
    owner: one(t.owner)?.full_name ?? null, client: one(t.client)?.name ?? null, category: one(t.category)?.name ?? null,
  })), new Date());

  const Stat = ({ label, n, href, warn }: { label: string; n: number; href: string; warn?: boolean }) => (
    <Link href={href} className="card block hover:border-brand">
      <div className={`text-3xl font-bold ${warn && n > 0 ? 'text-brand' : 'text-ink'}`}>{n}</div>
      <div className="text-sm text-stone-600">{label}</div>
    </Link>
  );
  const List = ({ title, rows }: { title: string; rows: (readonly [string, number])[] }) => (
    <div className="card">
      <h2 className="h2 mb-2">{title}</h2>
      {rows.length === 0 && <p className="text-sm text-stone-500">No open tickets.</p>}
      <ul className="divide-y divide-stone-100">
        {rows.slice(0, 12).map(([k, n]) => (
          <li key={k} className="flex justify-between py-1.5 text-sm"><span>{k}</span><span className="font-semibold">{n}</span></li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="h1">Backlog{can('tickets.read_all') ? '' : ' — my accounts'}</h1>
        <Link className="btn" href="/tickets/new">New ticket</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Open tickets" n={s.open} href="/tickets?view=open" />
        <Stat label="Overdue" n={s.overdue} href="/tickets?view=overdue" warn />
        <Stat label="No owner" n={s.unassigned} href="/tickets?view=unassigned" warn />
      </div>
      <h2 className="h2 mb-2 mt-6">How old are the open tickets?</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {s.byAge.map(([b, n], i) => <Stat key={b} label={b} n={n} href={`/tickets?view=open&age=${i}`} warn={i >= 2} />)}
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <List title="By owner" rows={s.byOwner} />
        <List title="By client" rows={s.byClient} />
        <List title="By category" rows={s.byCategory} />
      </div>
    </>
  );
}
