import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PageHeader, fmtDateTime } from '@/components/ui';

const HIDE = new Set(['updated_at', 'search']);
function changes(action: string, o: Record<string, unknown> | null, n: Record<string, unknown> | null) {
  if (action === 'INSERT') return 'Created';
  if (action === 'DELETE') return 'Removed';
  const keys = Object.keys(n ?? {}).filter((k) => !HIDE.has(k) && JSON.stringify(o?.[k]) !== JSON.stringify(n?.[k]));
  return keys.map((k) => `${k}: ${JSON.stringify(o?.[k] ?? null)} → ${JSON.stringify(n?.[k] ?? null)}`).join('\n') || 'No field change';
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const { table = '' } = await searchParams;
  const { supabase, can } = await getSession();
  if (!can('audit.read')) redirect('/');
  let q = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(200);
  if (table) q = q.eq('table_name', table);
  const [{ data: rows }, { data: people }] = await Promise.all([q, supabase.from('profiles').select('id, full_name')]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const tables = ['clients', 'client_sites', 'contacts', 'tickets', 'ticket_comments', 'ticket_attachments', 'attendance_logs', 'client_visits', 'profiles', 'role_permissions', 'ticket_categories'];
  return (
    <>
      <PageHeader title="Audit log" />
      <form className="mb-3 flex gap-2">
        <select className="input max-w-xs" name="table" defaultValue={table}><option value="">All tables</option>{tables.map((t) => <option key={t}>{t}</option>)}</select>
        <button className="btn-light">Filter</button>
      </form>
      <p className="mb-2 text-sm text-stone-500">Latest 200 entries. This log can only be added to; nobody can edit or delete it.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-stone-200"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Table</th><th className="th">Action</th><th className="th">What changed</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td className="td whitespace-nowrap">{fmtDateTime(r.at)}</td>
                <td className="td whitespace-nowrap">{r.actor_id ? name.get(r.actor_id) ?? 'Unknown' : 'System'}</td>
                <td className="td font-mono text-xs">{r.table_name}<div className="text-stone-400">{(r.new_row?.code ?? r.old_row?.code ?? '') as string}</div></td>
                <td className="td">{r.action}</td>
                <td className="td whitespace-pre-wrap break-all font-mono text-xs">{changes(r.action, r.old_row, r.new_row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
