'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { explain, getSession } from '@/lib/auth';
import { ACCREDITATION, clientSchema, contactSchema, firstIssue, siteSchema } from '@/lib/validation/schemas';

const back = (path: string, error: string): never => redirect(`${path}?error=${encodeURIComponent(error)}`);

export async function createClientAction(form: FormData) {
  const { supabase, user } = await getSession();
  const parsed = clientSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('/clients/new', firstIssue(parsed.error));
  const { data, error } = await supabase.from('clients')
    .insert({ ...parsed.data, account_owner: user.id }).select('id').single();
  if (error) return back('/clients/new', explain(error));
  redirect(`/clients/${data.id}`);
}

export async function updateClientAction(form: FormData) {
  const { supabase } = await getSession();
  const id = z.string().uuid().parse(form.get('id'));
  const parsed = clientSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return back(`/clients/${id}`, firstIssue(parsed.error));
  const { data, error } = await supabase.from('clients').update(parsed.data).eq('id', id).select('id');
  if (error || !data?.length) return back(`/clients/${id}`, error ? explain(error) : 'You are not allowed to do this.');
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}?notice=Saved`);
}

export async function setAccreditationAction(form: FormData) {
  const { supabase } = await getSession();
  const id = z.string().uuid().parse(form.get('id'));
  const status = z.enum(ACCREDITATION).safeParse(form.get('accreditation_status'));
  if (!status.success) return back(`/clients/${id}`, 'Choose a status.');
  const { data, error } = await supabase.from('clients').update({ accreditation_status: status.data }).eq('id', id).select('id');
  if (error || !data?.length) return back(`/clients/${id}`, error ? explain(error) : 'You are not allowed to do this.');
  redirect(`/clients/${id}?notice=Status+updated`);
}

export async function addSiteAction(form: FormData) {
  const { supabase } = await getSession();
  const parsed = siteSchema.safeParse(Object.fromEntries(form));
  const clientId = String(form.get('client_id'));
  if (!parsed.success) return back(`/clients/${clientId}`, firstIssue(parsed.error));
  const { error } = await supabase.from('client_sites').insert(parsed.data);
  if (error) return back(`/clients/${clientId}`, explain(error));
  redirect(`/clients/${clientId}?notice=Site+added`);
}

export async function addContactAction(form: FormData) {
  const { supabase } = await getSession();
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  const clientId = String(form.get('client_id'));
  if (!parsed.success) return back(`/clients/${clientId}`, firstIssue(parsed.error));
  const { error } = await supabase.from('contacts').insert(parsed.data);
  if (error) return back(`/clients/${clientId}`, explain(error));
  redirect(`/clients/${clientId}?notice=Contact+added`);
}
