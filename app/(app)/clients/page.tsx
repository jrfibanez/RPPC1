import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { Badge, PageHeader } from '@/components/ui';
import { ACCREDITATION } from '@/lib/validation/schemas';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = '', status = '' } = await searchParams;
  const { supabase, can } = await getSession();
  let query = supabase.from('clients')
    .select('id, code, name, accreditation_status, owner:profiles!clients_account_owner_fkey(full_name), client_sites(count)')
    .order('name').limit(500);
  const term = q.replace(/[%,()]/g, ' ').trim();
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  if ((ACCREDITATION as readonly string[]).includes(status)) query = query.eq('accreditation_status', status);
  const { data: clients } = await query;
  const canAdd = can('clients.write_all') || can('clients.write_own');

  return (
    <>
      <PageHeader title="Clients" action={canAdd ? { href: '/clients/new', label: 'New client' } : undefined} />
      <form className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" name="q" defaultValue={q} placeholder="Search name or code" />
        <select className="input max-w-[12rem]" name="status" defaultValue={status}>
          <option value="">All statuses</option>
          {ACCREDITATION.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button className="btn-light">Search</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-stone-200"><tr>
            <th className="th">Code</th><th className="th">Client</th><th className="th">Status</th><th className="th">Sites</th><th className="th">Account owner</th>
          </tr></thead>
          <tbody className="divide-y divide-stone-100">
            {(clients ?? []).map((c) => {
              const owner = Array.isArray(c.owner) ? c.owner[0] : c.owner;
              return (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="td whitespace-nowrap font-mono">{c.code}</td>
                  <td className="td"><Link className="font-semibold text-brand hover:underline" href={`/clients/${c.id}`}>{c.name}</Link></td>
                  <td className="td"><Badge value={c.accreditation_status} /></td>
                  <td className="td">{c.client_sites?.[0]?.count ?? 0}</td>
                  <td className="td">{owner?.full_name ?? '—'}</td>
                </tr>
              );
            })}
            {!clients?.length && <tr><td className="td text-stone-500" colSpan={5}>No clients found.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
