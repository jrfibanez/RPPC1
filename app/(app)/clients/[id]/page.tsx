import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Alert, Badge, fmtDate, fmtDateTime, pretty } from '@/components/ui';
import { ACCREDITATION, CHANNELS, ISLANDS } from '@/lib/validation/schemas';
import { addContactAction, addSiteAction, setAccreditationAction, updateClientAction } from '../actions';
import { ClientFields } from '../fields';

export default async function ClientPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { supabase, user, can } = await getSession();
  const { data: c } = await supabase.from('clients')
    .select('*, owner:profiles!clients_account_owner_fkey(full_name)').eq('id', id).maybeSingle();
  if (!c) notFound();
  const [{ data: sites }, { data: contacts }, { data: tickets }, { data: visits }] = await Promise.all([
    supabase.from('client_sites').select('*').eq('client_id', id).order('code'),
    supabase.from('contacts').select('*, site:client_sites(name)').eq('client_id', id).order('name'),
    supabase.from('tickets').select('id, code, subject, status, created_at').eq('client_id', id).is('voided_at', null).order('created_at', { ascending: false }).limit(20),
    supabase.from('client_visits').select('id, purpose, captured_at, who:profiles!client_visits_user_id_fkey(full_name)').eq('client_id', id).order('captured_at', { ascending: false }).limit(10),
  ]);
  const canWrite = can('clients.write_all') || (can('clients.write_own') && c.account_owner === user.id);
  const canAccredit = can('clients.accredit');
  const statusChoices = canAccredit ? ACCREDITATION : (['prospect', 'verified'] as const);
  const canSetStatus = canAccredit || (canWrite && ['prospect', 'verified'].includes(c.accreditation_status));

  return (
    <>
      <p className="mb-1 text-sm"><Link className="text-brand hover:underline" href="/clients">← Clients</Link></p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="h1">{c.name}</h1><span className="font-mono text-stone-500">{c.code}</span><Badge value={c.accreditation_status} />
      </div>
      <Alert error={error} notice={notice} />
      {c.accreditation_status !== 'accredited' && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Sales orders can be made only for <b>accredited</b> clients. Admin or Finance sets this.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <form action={updateClientAction} className="card space-y-3">
            <h2 className="h2">Details</h2>
            <input type="hidden" name="id" value={c.id} />
            <ClientFields v={c} disabled={!canWrite} />
            <p className="text-sm text-stone-500">Account owner: {(Array.isArray(c.owner) ? c.owner[0] : c.owner)?.full_name ?? '—'}</p>
            {canWrite && <button className="btn">Save</button>}
          </form>
          {canSetStatus && (
            <form action={setAccreditationAction} className="card flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="flex-1"><label className="label">Accreditation status</label>
                <select className="input" name="accreditation_status" defaultValue={c.accreditation_status}>
                  {statusChoices.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                </select></div>
              <button className="btn-light">Update status</button>
            </form>
          )}
          <div className="card">
            <div className="mb-2 flex items-center justify-between"><h2 className="h2">Tickets</h2>
              <Link className="text-sm font-semibold text-brand hover:underline" href={`/tickets/new?client=${c.id}`}>New ticket</Link></div>
            <ul className="divide-y divide-stone-100">
              {(tickets ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <Link className="hover:underline" href={`/tickets/${t.id}`}><span className="font-mono text-stone-500">{t.code}</span> {t.subject}</Link>
                  <span className="whitespace-nowrap"><Badge value={t.status} /> <span className="text-stone-500">{fmtDate(t.created_at)}</span></span>
                </li>
              ))}
              {!tickets?.length && <li className="py-1.5 text-sm text-stone-500">No tickets yet.</li>}
            </ul>
          </div>
          {!!visits?.length && (
            <div className="card"><h2 className="h2 mb-2">Recent visits</h2>
              <ul className="divide-y divide-stone-100">
                {visits.map((v) => (
                  <li key={v.id} className="flex justify-between py-1.5 text-sm"><span>{v.purpose} — {(Array.isArray(v.who) ? v.who[0] : v.who)?.full_name}</span><span className="text-stone-500">{fmtDateTime(v.captured_at)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="card">
            <h2 className="h2 mb-2">Sites</h2>
            <ul className="divide-y divide-stone-100">
              {(sites ?? []).map((s) => (
                <li key={s.id} className="py-1.5 text-sm"><span className="font-mono text-stone-500">{s.code}</span> <b>{s.name}</b> · {pretty(s.island_group)}<br /><span className="text-stone-500">{s.address}</span></li>
              ))}
              {!sites?.length && <li className="py-1.5 text-sm text-stone-500">No sites yet.</li>}
            </ul>
            {canWrite && (
              <form action={addSiteAction} className="mt-3 space-y-2 border-t border-stone-200 pt-3">
                <input type="hidden" name="client_id" value={c.id} />
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" name="name" placeholder="Site name *" required />
                  <select className="input" name="island_group">{ISLANDS.map((i) => <option key={i} value={i}>{pretty(i)}</option>)}</select>
                </div>
                <input className="input" name="address" placeholder="Address" />
                <button className="btn-light">Add site</button>
              </form>
            )}
          </div>
          <div className="card">
            <h2 className="h2 mb-2">Contacts</h2>
            <ul className="divide-y divide-stone-100">
              {(contacts ?? []).map((p) => (
                <li key={p.id} className="py-1.5 text-sm"><b>{p.name}</b>{p.position ? ` · ${p.position}` : ''}<br />
                  <span className="text-stone-500">{[p.mobile, p.email, p.preferred_channel && `prefers ${p.preferred_channel}`, (Array.isArray(p.site) ? p.site[0] : p.site)?.name].filter(Boolean).join(' · ')}</span></li>
              ))}
              {!contacts?.length && <li className="py-1.5 text-sm text-stone-500">No contacts yet.</li>}
            </ul>
            {canWrite && (
              <form action={addContactAction} className="mt-3 space-y-2 border-t border-stone-200 pt-3">
                <input type="hidden" name="client_id" value={c.id} />
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" name="name" placeholder="Name *" required />
                  <input className="input" name="position" placeholder="Position" />
                  <input className="input" name="mobile" placeholder="Mobile" />
                  <input className="input" name="email" type="email" placeholder="Email" />
                  <select className="input" name="site_id"><option value="">Any site</option>{(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <select className="input" name="preferred_channel"><option value="">Preferred channel</option>{CHANNELS.map((ch) => <option key={ch} value={ch}>{pretty(ch)}</option>)}</select>
                </div>
                <button className="btn-light">Add contact</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
