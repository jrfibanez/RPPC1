import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Role = 'admin' | 'sales' | 'deployment_officer' | 'driver' | 'production_officer' | 'maker'
  | 'painter' | 'guard' | 'hr' | 'finance' | 'purchasing' | 'warehouse';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin / CEO', sales: 'Sales', deployment_officer: 'Deployment Officer', driver: 'Driver / Helper',
  production_officer: 'Production Officer / QC', maker: 'Pallet Maker', painter: 'Painter', guard: 'Security Guard',
  hr: 'HR', finance: 'Finance', purchasing: 'Purchasing', warehouse: 'Warehouse / Inventory',
};

/** The signed-in user, their role and permissions. Redirects to login when there is none. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('full_name, role, is_active').eq('id', user.id).maybeSingle();
  if (!profile?.is_active) redirect('/logout?reason=inactive');
  const { data: perms } = await supabase.from('role_permissions').select('permission').eq('role', profile.role);
  const set = new Set((perms ?? []).map((p) => p.permission as string));
  return {
    supabase,
    user: { id: user.id, name: profile.full_name as string, role: profile.role as Role },
    can: (p: string) => set.has(p),
  };
});

/** Plain-language message for a database error. */
export function explain(error: { code?: string; message: string }): string {
  if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) return 'You are not allowed to do this.';
  if (error.code === '23505') return 'This record already exists.';
  return error.message;
}
