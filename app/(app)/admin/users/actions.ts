'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { explain, getSession } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ROLES, firstIssue, userSchema } from '@/lib/validation/schemas';

const back = (error: string): never => redirect('/admin/users?error=' + encodeURIComponent(error));

/** Every action here re-checks admin.users before the master key is used. */
const NO_KEY = 'Creating logins and changing passwords needs the server key (SUPABASE_SERVICE_ROLE_KEY), which is not set on this site yet.';
const hasKey = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireAdmin() {
  const session = await getSession();
  if (!session.can('admin.users')) back('You are not allowed to do this.');
  return session;
}

export async function createUserAction(form: FormData) {
  const { supabase } = await requireAdmin();
  const parsed = userSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return back(firstIssue(parsed.error));
  if (!hasKey()) return back(NO_KEY);
  const admin = createAdminClient();
  let email = parsed.data.email;
  if (!email) {
    // No real email: generate a login such as user-0007@rppc.local
    const { data: n, error } = await admin.rpc('next_master_no', { p_scope: 'login' });
    if (error) return back(error.message);
    email = `user-${String(n).padStart(4, '0')}@rppc.local`;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password: parsed.data.password, email_confirm: true });
  if (error) return back(/already/i.test(error.message) ? 'That email already has an account.' : error.message);
  // The profile is written as the signed-in admin, so the audit log names who created it.
  const ins = await supabase.from('profiles').insert({ id: data.user.id, full_name: parsed.data.full_name, login_email: email, role: parsed.data.role });
  if (ins.error) { await admin.auth.admin.deleteUser(data.user.id); return back(explain(ins.error)); }
  redirect('/admin/users?notice=' + encodeURIComponent(`Account created. Login: ${email}`));
}

export async function updateUserAction(form: FormData) {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ id: z.string().uuid(), role: z.enum(ROLES), is_active: z.enum(['true', 'false']) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('Check the form and try again.');
  const active = parsed.data.is_active === 'true';
  const { data, error } = await supabase.from('profiles').update({ role: parsed.data.role, is_active: active }).eq('id', parsed.data.id).select('id');
  if (error || !data?.length) return back(error ? explain(error) : 'You are not allowed to do this.');
  // Turning an account off also blocks its login and ends its sessions.
  // (Even without this step, a turned-off account can read and change nothing: the database refuses it.)
  if (hasKey()) await createAdminClient().auth.admin.updateUserById(parsed.data.id, { ban_duration: active ? 'none' : '876000h' });
  redirect('/admin/users?notice=Saved');
}

export async function resetPasswordAction(form: FormData) {
  await requireAdmin();
  const parsed = z.object({ id: z.string().uuid(), password: z.string().min(8) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('The new password must be at least 8 characters.');
  if (!hasKey()) return back(NO_KEY);
  const { error } = await createAdminClient().auth.admin.updateUserById(parsed.data.id, { password: parsed.data.password });
  if (error) return back(error.message);
  redirect('/admin/users?notice=Password+changed');
}
