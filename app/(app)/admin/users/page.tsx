import { redirect } from 'next/navigation';
import { getSession, ROLE_LABELS, type Role } from '@/lib/auth';
import { Alert, PageHeader } from '@/components/ui';
import { ROLES } from '@/lib/validation/schemas';
import { createUserAction, resetPasswordAction, updateUserAction } from './actions';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const { supabase, user, can } = await getSession();
  if (!can('admin.users')) redirect('/');
  const { data: users } = await supabase.from('profiles').select('*').order('full_name');
  const RoleSelect = ({ value }: { value?: string }) => (
    <select className="input" name="role" defaultValue={value ?? 'sales'}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r as Role]}</option>)}</select>
  );
  return (
    <>
      <PageHeader title="Users" />
      <Alert error={error} notice={notice} />
      <form action={createUserAction} className="card mb-6 grid gap-3 md:grid-cols-5">
        <div className="md:col-span-5"><h2 className="h2">Create account</h2><p className="text-sm text-stone-500">People cannot sign up on their own. Leave email empty for staff without an email; a login is generated.</p></div>
        <input className="input" name="full_name" placeholder="Full name *" required />
        <input className="input" name="email" type="email" placeholder="Email (optional)" />
        <RoleSelect />
        <input className="input" name="password" type="text" placeholder="Starting password *" minLength={8} required autoComplete="off" />
        <button className="btn">Create</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-stone-200"><tr><th className="th">Name</th><th className="th">Login</th><th className="th">Role and status</th><th className="th">New password</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {(users ?? []).map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'bg-stone-100 text-stone-500'}>
                <td className="td font-semibold">{u.full_name}{u.id === user.id && ' (you)'}</td>
                <td className="td font-mono text-xs">{u.login_email}</td>
                <td className="td">
                  {u.id === user.id ? <span>{ROLE_LABELS[u.role as Role]} · Active</span> : (
                    <form action={updateUserAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <div className="w-48"><RoleSelect value={u.role} /></div>
                      <select className="input w-28" name="is_active" defaultValue={String(u.is_active)}><option value="true">Active</option><option value="false">Turned off</option></select>
                      <button className="btn-light">Save</button>
                    </form>)}
                </td>
                <td className="td">
                  <form action={resetPasswordAction} className="flex gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input className="input w-40" name="password" type="text" minLength={8} required placeholder="At least 8 characters" autoComplete="off" />
                    <button className="btn-light">Set</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
