import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { DEMO_PASSWORD, USERS, type UserKey } from '../../scripts/seed-data';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Bypasses RLS. Only for building fixtures and checking results. */
export const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, noSession);
export const anon = createClient(url, anonKey, noSession);
export const sql = new Pool({ connectionString: process.env.SUPABASE_DB_URL!, max: 3 });

export const ROLES = ['admin', 'sales', 'deployment_officer', 'driver', 'production_officer', 'maker',
  'painter', 'guard', 'hr', 'finance', 'purchasing', 'warehouse'] as const;
export type Role = (typeof ROLES)[number];

/** The seeded user used to represent each role. */
export const userFor = (role: Role): UserKey => (role === 'sales' ? 'sales1' : role);

const sessions = new Map<string, Promise<{ client: SupabaseClient; id: string }>>();

export function signIn(email: string, password = DEMO_PASSWORD) {
  if (!sessions.has(email)) {
    sessions.set(email, (async () => {
      const client = createClient(url, anonKey, noSession);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}. Run npm run db:reset first.`);
      return { client, id: data.user.id };
    })());
  }
  return sessions.get(email)!;
}

/** A Supabase client signed in as a seeded user, limited by RLS like the real app. */
export async function as(key: UserKey): Promise<SupabaseClient> {
  return (await signIn(USERS.find((u) => u.key === key)!.email)).client;
}
export async function idOf(key: UserKey): Promise<string> {
  return (await signIn(USERS.find((u) => u.key === key)!.email)).id;
}

export function ok<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

export const tag = () => Math.random().toString(36).slice(2, 10);

export async function categoryId(): Promise<string> {
  return ok(await service.from('ticket_categories').select('id').limit(1).single()).id;
}

/** A client owned by `owner`, with one site, one contact and one ticket. */
export async function makeAccount(owner: UserKey) {
  const ownerId = await idOf(owner);
  const t = tag();
  const client = ok(await service.from('clients').insert({ name: `Test Client ${t}`, account_owner: ownerId }).select().single());
  const site = ok(await service.from('client_sites').insert({ client_id: client.id, name: `Site ${t}` }).select().single());
  const contact = ok(await service.from('contacts').insert({ client_id: client.id, name: `Contact ${t}` }).select().single());
  const ticket = ok(await service.from('tickets').insert({
    client_id: client.id, site_id: site.id, channel: 'viber', category_id: await categoryId(),
    subject: `Concern ${t}`, description: `uniq${t}`, owner_id: ownerId, created_by: ownerId,
  }).select().single());
  return { client, site, contact, ticket, ownerId, token: `uniq${t}` };
}

export async function closeOpenShifts(userId: string) {
  ok(await service.from('attendance_logs').update({ clock_out_at: new Date().toISOString() })
    .eq('user_id', userId).is('clock_out_at', null).select('id'));
}
