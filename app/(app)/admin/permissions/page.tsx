import { redirect } from 'next/navigation';
import { z } from 'zod';
import { explain, getSession, ROLE_LABELS, type Role } from '@/lib/auth';
import { Alert, PageHeader } from '@/components/ui';
import { LOCKED, PERMISSIONS } from '@/lib/permissions';
import { ROLES } from '@/lib/validation/schemas';

async function toggleAction(form: FormData) {
  'use server';
  const { supabase } = await getSession();
  const p = z.object({ role: z.enum(ROLES), permission: z.enum(PERMISSIONS.map(([k]) => k) as [string, ...string[]]), on: z.enum(['1', '0']) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect('/admin/permissions?error=Bad+request');
  const { role, permission, on } = p.data;
  const res = on === '1'
    ? await supabase.from('role_permissions').insert({ role, permission })
    : await supabase.from('role_permissions').delete().eq('role', role).eq('permission', permission);
  if (res.error) redirect('/admin/permissions?error=' + encodeURIComponent(explain(res.error)));
  redirect('/admin/permissions');
}

export default async function PermissionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase, can } = await getSession();
  if (!can('admin.permissions')) redirect('/');
  const { data } = await supabase.from('role_permissions').select('role, permission');
  const has = new Set((data ?? []).map((r) => `${r.role}:${r.permission}`));
  return (
    <>
      <PageHeader title="Permissions" />
      <Alert error={error} />
      <p className="mb-3 text-sm text-stone-600">Click a box to turn a permission on or off. Changes apply at once and are recorded in the audit log.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead className="border-b border-stone-200"><tr><th className="th min-w-64">Permission</th>
            {ROLES.map((r) => <th key={r} className="px-1 py-2 text-center font-semibold text-stone-600">{ROLE_LABELS[r as Role]}</th>)}</tr></thead>
          <tbody className="divide-y divide-stone-100">
            {PERMISSIONS.map(([perm, label]) => (
              <tr key={perm}>
                <td className="td"><div className="font-semibold">{label}</div><div className="font-mono text-stone-400">{perm}</div></td>
                {ROLES.map((r) => {
                  const on = has.has(`${r}:${perm}`); const locked = LOCKED.has(`${r}:${perm}`);
                  return (
                    <td key={r} className="px-1 py-2 text-center">
                      <form action={toggleAction}>
                        <input type="hidden" name="role" value={r} /><input type="hidden" name="permission" value={perm} /><input type="hidden" name="on" value={on ? '0' : '1'} />
                        <button disabled={locked} title={locked ? 'Admin always keeps this' : `${on ? 'Remove from' : 'Give to'} ${ROLE_LABELS[r as Role]}`}
                          aria-label={`${label} for ${ROLE_LABELS[r as Role]}: ${on ? 'on' : 'off'}`}
                          className={`h-6 w-6 rounded border text-sm font-bold ${on ? 'border-green-700 bg-green-700 text-white' : 'border-stone-300 bg-white text-transparent'} ${locked ? 'opacity-60' : 'cursor-pointer'}`}>✓</button>
                      </form>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
